import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentRun } from "./agent.js";
import { OkfBundle } from "./bundle.js";
import { startGui } from "./gui.js";

const run: AgentRun = {
  question: "What is the answer?",
  answer: "A source-backed answer.",
  toolCalls: [],
  conceptsDiscovered: [],
  conceptsRead: [],
  linksFollowed: 0,
  sources: ["https://example.com/source"],
  unsupportedCitations: [],
  latencyMs: 12,
  inputTokens: 4,
  outputTokens: 7,
  stop: "completed",
  model: "test-model",
};

async function withGui<T>(
  action: (origin: string) => Promise<T>,
  ask: (question: string) => Promise<AgentRun> = async (question) => ({ ...run, question }),
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "okf-gui-test-"));
  const bundle = await OkfBundle.open(root);
  const server = await startGui(bundle, { port: 0, ask });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    return await action(origin);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

async function request(
  origin: string,
  path: string,
  options: { method?: string; body?: string; host?: string; requestOrigin?: string; contentType?: string; omitOrigin?: boolean } = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const url = new URL(path, origin);
  return await new Promise((resolve, reject) => {
    const outgoing = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: options.method ?? "GET",
      headers: {
        ...(options.body === undefined ? {} : { "content-type": options.contentType ?? "application/json" }),
        ...(options.host === undefined ? {} : { host: options.host }),
        ...(options.requestOrigin === undefined ? {} : { origin: options.requestOrigin }),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    outgoing.on("error", reject);
    if (!options.omitOrigin) outgoing.setHeader("origin", options.requestOrigin ?? origin);
    if (options.body !== undefined) outgoing.end(options.body);
    else outgoing.end();
  });
}

test("serves only the fixed GUI assets and rejects unknown routes", async () => {
  await withGui(async (origin) => {
    const page = await request(origin, "/");
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"]?.toString() ?? "", /text\/html/);
    assert.match(page.body, /InfoMagnus/);
    for (const asset of ["/app.js", "/theme.js", "/vendor/marked.js", "/vendor/purify.es.mjs", "/styles.css"]) {
      assert.equal((await request(origin, asset)).status, 200);
    }
    assert.match((await request(origin, "/styles.css")).body, /prefers-reduced-motion/);
    assert.match((await request(origin, "/app.js")).body, /textContent/);
    assert.equal((await request(origin, "/agent.js")).status, 404);
    assert.equal((await request(origin, "/api/ask")).status, 405);
  });
});

test("serves an accessible single-line composer and browser Markdown modules", async () => {
  await withGui(async (origin) => {
    const page = await request(origin, "/");
    assert.match(page.body, /<input id="question"[^>]*type="text"/);
    assert.doesNotMatch(page.body, /<textarea/);
    assert.match(page.body, /Press Enter to send/);
    assert.doesNotMatch(page.body, /Shift\s*\+\s*Enter/);
    for (const asset of ["/vendor/marked.js", "/vendor/purify.es.mjs"]) {
      const assetResponse = await request(origin, asset);
      assert.equal(assetResponse.status, 200);
      assert.match(assetResponse.headers["content-type"]?.toString() ?? "", /javascript/);
    }
    assert.match((await request(origin, "/app.js")).body, /marked\.parse/);
    assert.match((await request(origin, "/app.js")).body, /DOMPurify\.sanitize/);
    assert.match((await request(origin, "/styles.css")).body, /scrollbar-width:\s*none/);
  });
});

test("validates and forwards one trimmed question, returning its AgentRun", async () => {
  const questions: string[] = [];
  await withGui(async (origin) => {
    const response = await request(origin, "/api/ask", { method: "POST", body: JSON.stringify({ question: "  What is the answer?  " }) });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { run: { ...run, question: "What is the answer?" } });
  }, async (question) => {
    questions.push(question);
    return { ...run, question };
  });
  assert.deepEqual(questions, ["What is the answer?"]);
});

test("returns restrictive response headers and never binds beyond loopback", async () => {
  await withGui(async (origin) => {
    const response = await request(origin, "/");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.match(response.headers["content-security-policy"]?.toString() ?? "", /default-src 'self'/);
    assert.equal(response.headers["access-control-allow-origin"], undefined);
  });
});

test("rejects malformed JSON, empty questions, invalid payloads, and oversized bodies", async () => {
  await withGui(async (origin) => {
    assert.equal((await request(origin, "/api/ask", { method: "POST", body: JSON.stringify({ question: "hello" }), contentType: "text/plain" })).status, 415);
    assert.equal((await request(origin, "/api/ask", { method: "POST", body: "{" })).status, 400);
    assert.equal((await request(origin, "/api/ask", { method: "POST", body: JSON.stringify({ question: "   " }) })).status, 400);
    assert.equal((await request(origin, "/api/ask", { method: "POST", body: JSON.stringify({ question: "q".repeat(4001) }) })).status, 400);
    assert.equal((await request(origin, "/api/ask", { method: "POST", body: JSON.stringify({ other: "value" }) })).status, 400);
    assert.equal((await request(origin, "/api/ask", { method: "POST", body: "x".repeat(16 * 1024 + 1) })).status, 413);
  });
});

test("rejects non-loopback hosts and cross-origin requests", async () => {
  await withGui(async (origin) => {
    const { port } = new URL(origin);
    assert.equal((await request(origin, "/", { host: `attacker.example:${port}` })).status, 403);
    assert.equal((await request(origin, "/", { host: `127.0.0.1.evil:${port}` })).status, 403);
    assert.equal((await request(origin, "/api/ask", { method: "POST", body: JSON.stringify({ question: "hello" }), requestOrigin: "https://attacker.example" })).status, 403);
    assert.equal((await request(origin, "/", { requestOrigin: "null" })).status, 403);
  });
});

test("accepts question submissions only with an allowed origin", async () => {
  await withGui(async (origin) => {
    assert.equal((await request(origin, "/api/ask", { method: "POST", body: JSON.stringify({ question: "hello" }), omitOrigin: true })).status, 403);
    assert.equal((await request(origin, "/api/ask", { method: "POST", body: JSON.stringify({ question: "hello" }), requestOrigin: origin })).status, 200);
    assert.equal((await request(origin, "/", { omitOrigin: true })).status, 200);
  });
});

test("redacts answer provider failures", async () => {
  await withGui(async (origin) => {
    const response = await request(origin, "/api/ask", { method: "POST", body: JSON.stringify({ question: "hello" }) });
    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(response.body), { error: "The answer could not be generated. Please try again." });
    assert.doesNotMatch(response.body, /private provider detail|secret-key/);
  }, async () => {
    throw new Error("private provider detail secret-key");
  });
});

test("server closes cleanly after use", async () => {
  await withGui(async (origin) => {
    assert.equal((await request(origin, "/")).status, 200);
  });
});
