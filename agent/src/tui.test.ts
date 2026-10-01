import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { AgentRun } from "./agent.js";
import { OkfBundle } from "./bundle.js";
import { runTui } from "./tui.js";

async function sendLines(input: PassThrough, lines: string[]): Promise<void> {
  for (const line of lines) {
    input.write(`${line}\n`);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  input.end();
}

test("interactive TUI answers questions and handles help and quit commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-tui-"));
  const previous = process.cwd();
  const input = new PassThrough();
  const output = new PassThrough();
  const outputChunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => outputChunks.push(chunk));
  const asked: string[] = [];
  try {
    process.chdir(root);
    await mkdir("okf", { recursive: true });
    await writeFile("okf/index.md", "# Index\n");
    const bundle = await OkfBundle.open("okf");
    const run: AgentRun = {
      question: "Which services are available?",
      answer: "InfoMagnus works in these areas:\n\n1. **AI-Powered Application Modernization** — modernizing legacy applications faster with AI, GitHub Copilot, and proven engineering methods {\"path\":\"services/ai-powered-application-modernization.md\"}\n2. **Data and AI Services** — turning data into intelligent systems that drive automation, insight, and measurable business outcomes.\n\nSee [our services](https://www.infomagnus.com/services) for details.",
      toolCalls: [{ name: "list_concepts", arguments: {}, result: [] }],
      conceptsDiscovered: [],
      conceptsRead: [],
      linksFollowed: 0,
      sources: ["https://www.infomagnus.com/services"],
      unsupportedCitations: ["https://example.com/unverified"],
      latencyMs: 120,
      inputTokens: 12,
      outputTokens: 28,
      stop: "completed",
      model: "openai/gpt-oss-120b",
    };
    const tui = runTui(bundle, input, output, async (_knowledge, question) => {
      asked.push(question);
      return { ...run, question };
    }, false);
    const sent = sendLines(input, ["/help", "Which services are available?", "/quit"]);
    await tui;
    await sent;

    const rendered = Buffer.concat(outputChunks).toString("utf8");
    assert.deepEqual(asked, ["Which services are available?"]);
    assert.match(rendered, /InfoMagnus OKF Chat/);
    assert.match(rendered, /\/compose\s+Write a multiline question/);
    assert.match(rendered, /\/help\s+Show available commands/);
    assert.match(rendered, /You\n  Which services are available\?/);
    assert.match(rendered, /InfoMagnus\n\n  InfoMagnus works in these areas:/);
    assert.match(rendered, /1\. AI-Powered Application Modernization/);
    assert.match(rendered, /2\. Data and AI Services/);
    assert.doesNotMatch(rendered, /\{"path"/);
    assert.match(rendered, /See our services \(https:\/\/www\.infomagnus\.com\/services\) for details\./);
    assert.match(rendered, /Sources\n  • https:\/\/www\.infomagnus\.com\/services/);
    assert.match(rendered, /Unverified citations\n  https:\/\/example\.com\/unverified/);
    assert.match(rendered, /openai\/gpt-oss-120b  ·  1 tool call  ·  120 ms\n  12 in \/ 28 out/);
    assert.doesNotMatch(rendered, /Thinking through the OKF|Working on your answer|Searching the OKF/);
    assert.doesNotMatch(rendered, /\u001b\[/);
    assert.match(rendered, /Goodbye\./);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("multiline composition submits joined lines and supports cancel", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-tui-compose-"));
  const previous = process.cwd();
  const input = new PassThrough();
  const output = new PassThrough();
  const outputChunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => outputChunks.push(chunk));
  const asked: string[] = [];
  try {
    process.chdir(root);
    await mkdir("okf", { recursive: true });
    await writeFile("okf/index.md", "# Index\n");
    const bundle = await OkfBundle.open("okf");
    const run: AgentRun = {
      question: "",
      answer: "Answer",
      toolCalls: [],
      conceptsDiscovered: [],
      conceptsRead: [],
      linksFollowed: 0,
      sources: [],
      unsupportedCitations: [],
      latencyMs: 1,
      inputTokens: null,
      outputTokens: null,
      stop: "completed",
      model: "openai/gpt-oss-120b",
    };
    const tui = runTui(bundle, input, output, async (_knowledge, question) => {
      asked.push(question);
      return { ...run, question };
    }, false);
    const sent = sendLines(input, ["/compose", "/send", "/compose", "Summarize modernization", "including its", "benefits", "/send", "/compose", "ignored draft", "/cancel", "/quit"]);
    await tui;
    await sent;

    const rendered = Buffer.concat(outputChunks).toString("utf8");
    assert.deepEqual(asked, ["Summarize modernization\nincluding its\nbenefits"]);
    assert.match(rendered, /You\n  Summarize modernization\n  including its\n  benefits/);
    assert.match(rendered, /Empty question\. Composition cancelled\./);
    assert.match(rendered, /Composition cancelled\./);
    assert.match(rendered, /Goodbye\./);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("TTY mode uses readline echo once and waits without a status animation", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-tui-tty-"));
  const previous = process.cwd();
  const input = new PassThrough();
  const output = new PassThrough();
  Object.assign(output, { columns: 48 });
  const outputChunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => outputChunks.push(chunk));
  try {
    process.chdir(root);
    await mkdir("okf", { recursive: true });
    await writeFile("okf/index.md", "# Index\n");
    const bundle = await OkfBundle.open("okf");
    const run: AgentRun = {
      question: "hello",
      answer: "This is a deliberately long answer that should wrap cleanly across a narrow console width without exceeding the available terminal columns or leaving internal data visible {\"path\":\"internal/example.md\"}.",
      toolCalls: [],
      conceptsDiscovered: [],
      conceptsRead: [],
      linksFollowed: 0,
      sources: [],
      unsupportedCitations: [],
      latencyMs: 2,
      inputTokens: null,
      outputTokens: null,
      stop: "completed",
      model: "openai/gpt-oss-120b",
    };
    Object.assign(output, { columns: 48 });
    const tui = runTui(bundle, input, output, async () => run, true);
    const sent = sendLines(input, ["hello", "/quit"]);
    await tui;
    await sent;

    const rendered = Buffer.concat(outputChunks).toString("utf8");
    assert.equal(rendered.split("hello").length - 1, 1);
    assert.match(rendered, /This is a deliberately long answer that should\r?\n  wrap cleanly/);
    assert.match(rendered, /without exceeding the available terminal\r?\n  columns/);
    assert.doesNotMatch(rendered, /\{"path"/);
    assert.doesNotMatch(rendered, /Thinking|Searching|Working on your answer|\u001b\[\?25l/);
    assert.match(rendered, /\u001b\[36m›\u001b\[0m/);
    const plain = rendered.replace(/\u001b\[[0-9;]*m/g, "");
    assert.ok(plain.split(/\r?\n/).every((line) => [...line].length <= 48));
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});
