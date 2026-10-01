import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { answerQuestion } from "./agent.js";
import { OkfBundle } from "./bundle.js";
import type { ChatMessage } from "./groq.js";
import { sha256 } from "./types.js";

test("agent discovers a concept through a tool before returning its answer", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-agent-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    await mkdir("okf/services", { recursive: true });
    for (const category of ["company", "services", "solutions", "industries", "technologies", "capabilities", "case-studies", "insights"]) {
      await mkdir(`okf/${category}`, { recursive: true });
      await writeFile(`okf/${category}/index.md`, `# ${category}\n`);
    }
    const source = "InfoMagnus helps teams modernize applications with AI-assisted engineering and structured testing. The service includes planning, implementation, and validation for legacy application work. This work is supported by trained engineers and a delivery process.";
    const url = "https://www.infomagnus.com/infomagnus-services/ai-powered-application-modernization";
    await writeFile("site-inventory.json", JSON.stringify({ version: 1, site: "https://www.infomagnus.com/", complete: true, pages: [{ url, title: "Application Modernization", headings: [], text: source, internalLinks: [], externalLinks: [], metadata: {}, contentHash: sha256(source), stale: false }] }));
    await writeFile("okf/index.md", "# Index\n");
    await writeFile("okf/services/application-modernization.md", `---\ntype: Service\ntitle: Application Modernization\ndescription: >-\n  ${source}\nresource: ${url}\nevidence:\n  resource: ${url}\n  quote: >-\n    ${source}\n---\n\n# Application Modernization\n\n${source}\n`);
    const bundle = await OkfBundle.open("okf");
    const turns = [
      { content: null, reasoning: "Find a concept first.", toolCalls: [{ id: "call-1", name: "search_concepts", arguments: JSON.stringify({ query: "application modernization" }) }], finishReason: "tool_calls", inputTokens: 20, outputTokens: 5 },
      { content: null, reasoning: "Read the matching concept.", toolCalls: [{ id: "call-2", name: "read_concept", arguments: JSON.stringify({ path: "services/application-modernization.md" }) }], finishReason: "tool_calls", inputTokens: 12, outputTokens: 4 },
      { content: "InfoMagnus helps teams modernize applications with AI-assisted engineering and structured testing.", reasoning: null, toolCalls: [], finishReason: "stop", inputTokens: 30, outputTokens: 12 },
    ];
    const conversationSnapshots: ChatMessage[][] = [];
    const run = await answerQuestion(bundle, "What does the service do?", {
      maxSteps: 3,
      completeTurn: async (messages) => {
        conversationSnapshots.push(messages);
        const turn = turns.shift();
        if (!turn) throw new Error("Unexpected model turn.");
        return turn;
      },
    });
    assert.equal(run.answer, "InfoMagnus helps teams modernize applications with AI-assisted engineering and structured testing.");
    assert.equal(run.toolCalls.length, 2);
    assert.equal(run.toolCalls[0]?.name, "search_concepts");
    assert.equal(run.toolCalls[1]?.name, "read_concept");
    assert.deepEqual(run.conceptsDiscovered, ["services/application-modernization.md"]);
    assert.deepEqual(run.conceptsRead, ["services/application-modernization.md"]);
    assert.deepEqual(run.sources, [url]);
    assert.equal(run.inputTokens, 62);
    assert.equal(run.outputTokens, 21);
    assert.equal(run.stop, "completed");
    assert.equal(conversationSnapshots[1]?.[2]?.reasoning, "Find a concept first.");
    assert.equal(conversationSnapshots[1]?.[3]?.tool_call_id, "call-1");
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("list_concepts treats a null type as no filter", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-agent-list-null-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    await mkdir("okf/services", { recursive: true });
    await writeFile("okf/services/application-modernization.md", `---\ntype: Service\ntitle: Application Modernization\ndescription: Modernization services for enterprise applications.\nresource: https://www.infomagnus.com/infomagnus-services/ai-powered-application-modernization\nevidence:\n  resource: https://www.infomagnus.com/infomagnus-services/ai-powered-application-modernization\n  quote: Modernization services for enterprise applications.\n---\n`);
    const bundle = await OkfBundle.open("okf");
    let turnCount = 0;
    const run = await answerQuestion(bundle, "List all concepts", {
      completeTurn: async () => {
        turnCount += 1;
        return turnCount === 1
          ? {
            content: null,
            reasoning: null,
            toolCalls: [{ id: "call-list", name: "list_concepts", arguments: JSON.stringify({ type: null }) }],
            finishReason: "tool_calls",
            inputTokens: null,
            outputTokens: null,
          }
          : { content: "There is one concept.", reasoning: null, toolCalls: [], finishReason: "stop", inputTokens: null, outputTokens: null };
      },
    });

    assert.equal(run.answer, "There is one concept.");
    assert.deepEqual(run.toolCalls[0]?.result, [{
      path: "services/application-modernization.md",
      type: "Service",
      title: "Application Modernization",
      description: "Modernization services for enterprise applications.",
    }]);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("agent stops at the configured maximum tool steps", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-agent-limit-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    await mkdir("okf", { recursive: true });
    await writeFile("okf/index.md", "# Index\n");
    const bundle = await OkfBundle.open("okf");
    const run = await answerQuestion(bundle, "Question", {
      maxSteps: 1,
      completeTurn: async () => ({ content: null, reasoning: null, toolCalls: [{ id: "call-1", name: "list_concepts", arguments: "{}" }], finishReason: "tool_calls", inputTokens: null, outputTokens: null }),
    });
    assert.equal(run.stop, "step-limit");
    assert.match(run.answer, /tool-step limit/);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("agent refuses a final answer when the model skipped the knowledge tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-agent-no-tools-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    await mkdir("okf", { recursive: true });
    await writeFile("okf/index.md", "# Index\n");
    const bundle = await OkfBundle.open("okf");
    const run = await answerQuestion(bundle, "Question", {
      completeTurn: async () => ({ content: "Unsupported answer", reasoning: null, toolCalls: [], finishReason: "stop", inputTokens: null, outputTokens: null }),
    });
    assert.match(run.answer, /No OKF knowledge tools were used/);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});
