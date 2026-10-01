import assert from "node:assert/strict";
import test from "node:test";
import { runAgent } from "./core-agent.js";
import { parseKnowledgeCatalog } from "./catalog.js";

const catalog = parseKnowledgeCatalog({
  version: 1,
  concepts: [{
    path: "services/application-modernization.md",
    type: "Service",
    title: "Application Modernization",
    description: "Modernization services for enterprise applications.",
    resource: "https://example.com/modernization",
    tags: ["engineering"],
    evidence: { source: "https://example.com/modernization", quote: "Modernization services for enterprise applications." },
    relations: [],
  }],
});

test("runs the portable tool loop and returns a source-backed result", async () => {
  let turnCount = 0;
  const run = await runAgent({
    catalog,
    systemPrompt: "Use the OKF tools before answering.",
    completeTurn: async () => {
      turnCount += 1;
      return turnCount === 1
        ? { content: null, reasoning: null, toolCalls: [{ id: "call-1", name: "read_concept", arguments: JSON.stringify({ path: "services/application-modernization.md" }) }], finishReason: "tool_calls", inputTokens: 13, outputTokens: 3 }
        : { content: "Modernization services for enterprise applications. [source](https://example.com/modernization) https://example.com/unsupported]", reasoning: null, toolCalls: [], finishReason: "stop", inputTokens: 17, outputTokens: 8 };
    },
  }, "What does the service offer?", { maxSteps: 2, model: "test-model" });

  assert.equal(run.answer, "Modernization services for enterprise applications. [source](https://example.com/modernization) https://example.com/unsupported]");
  assert.deepEqual(run.conceptsRead, ["services/application-modernization.md"]);
  assert.deepEqual(run.sources, ["https://example.com/modernization"]);
  assert.deepEqual(run.unsupportedCitations, ["https://example.com/unsupported"]);
  assert.equal(run.inputTokens, 30);
  assert.equal(run.outputTokens, 11);
  assert.equal(run.stop, "completed");
  assert.equal(run.model, "test-model");
});