import assert from "node:assert/strict";
import test from "node:test";
import { handleWorkerRequest, type WorkerEnvironment } from "./worker.js";

const pageOrigin = "https://grok08.github.io";
const catalogJson = JSON.stringify({
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

function environment(limits: boolean[] = []): WorkerEnvironment {
  return {
    GROQ_API_KEY: "test-secret",
    GROQ_MODEL: "test-model",
    PAGES_ORIGIN: pageOrigin,
    ASSETS: { fetch: async (input) => new Response(new URL(String(input)).pathname === "/knowledge-catalog.json" ? catalogJson : "Use only evidence from the OKF catalog.", { status: 200 }) },
    RATE_LIMITER: { limit: async () => ({ success: limits.shift() ?? true }) },
  };
}

function askRequest(question: unknown): Request {
  return new Request("https://worker.example.workers.dev/api/ask", {
    method: "POST",
    headers: { origin: pageOrigin, "content-type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
    body: JSON.stringify({ question }),
  });
}

test("returns the shared AgentRun with a tool-backed answer and CORS headers", async () => {
  const env = environment();
  const assetPaths: string[] = [];
  const limiterKeys: string[] = [];
  env.ASSETS = { fetch: async (input) => {
    const path = new URL(String(input)).pathname;
    assetPaths.push(path);
    return new Response(path === "/knowledge-catalog.json" ? catalogJson : "Use only evidence from the OKF catalog.", { status: 200 });
  } };
  env.RATE_LIMITER = { limit: async ({ key }) => { limiterKeys.push(key); return { success: true }; } };
  const providerBodies: Array<Record<string, unknown>> = [];
  const authorizationHeaders: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    providerBodies.push(body);
    authorizationHeaders.push(new Headers(init?.headers).get("authorization") ?? "");
    const toolTurn = providerBodies.length % 2 === 1;
    return new Response(JSON.stringify({
      choices: [{ message: toolTurn
        ? { content: null, tool_calls: [{ id: "call-1", function: { name: "read_concept", arguments: JSON.stringify({ path: "services/application-modernization.md" }) } }] }
        : { content: "Modernization services for enterprise applications. https://example.com/modernization", tool_calls: [] }, finish_reason: toolTurn ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 5 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const response = await handleWorkerRequest(askRequest("  What does modernization include?  "), env, fetcher);
  const payload = await response.json() as { run: { question: string; answer: string; sources: string[]; unsupportedCitations: string[]; stop: string; model: string; toolCalls: Array<{ name: string }>; inputTokens: number; outputTokens: number } };

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), pageOrigin);
  assert.deepEqual({
    question: payload.run.question,
    answer: payload.run.answer,
    sources: payload.run.sources,
    unsupportedCitations: payload.run.unsupportedCitations,
    stop: payload.run.stop,
    model: payload.run.model,
    toolCalls: payload.run.toolCalls.map((call) => call.name),
    inputTokens: payload.run.inputTokens,
    outputTokens: payload.run.outputTokens,
  }, {
    question: "What does modernization include?",
    answer: "Modernization services for enterprise applications. https://example.com/modernization",
    sources: ["https://example.com/modernization"],
    unsupportedCitations: [],
    stop: "completed",
    model: "test-model",
    toolCalls: ["read_concept"],
    inputTokens: 22,
    outputTokens: 10,
  });
  const repeatedResponse = await handleWorkerRequest(askRequest("What is the service?"), env, fetcher);
  assert.equal(repeatedResponse.status, 200);
  assert.equal(providerBodies.length, 4);
  assert.deepEqual(assetPaths, ["/knowledge-catalog.json", "/system-prompt.md"]);
  assert.deepEqual(limiterKeys, ["203.0.113.9", "203.0.113.9"]);
  assert.deepEqual(authorizationHeaders, ["Bearer test-secret", "Bearer test-secret", "Bearer test-secret", "Bearer test-secret"]);
  assert.deepEqual((providerBodies[0]?.messages as Array<{ role: string; content: string }>)[0], {
    role: "system",
    content: "Use only evidence from the OKF catalog.",
  });
});

test("handles the allowed Pages preflight with the requested method and header", async () => {
  const response = await handleWorkerRequest(new Request("https://worker.example.workers.dev/api/ask", {
    method: "OPTIONS",
    headers: { origin: pageOrigin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
  }), environment());

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), pageOrigin);
  assert.equal(response.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.equal(response.headers.get("access-control-allow-headers"), "content-type");
});

test("rejects an unapproved origin without contacting the limiter or provider", async () => {
  const response = await handleWorkerRequest(new Request("https://worker.example.workers.dev/api/ask", {
    method: "POST",
    headers: { origin: "https://attacker.example", "content-type": "application/json" },
    body: JSON.stringify({ question: "hello" }),
  }), environment());

  assert.equal(response.status, 403);
  assert.equal(await response.text(), JSON.stringify({ error: "Request origin is not allowed." }));
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("rejects oversized and invalid question bodies before calling Groq", async () => {
  const env = environment();
  const fetcher: typeof fetch = async () => { throw new Error("Provider must not be called."); };
  const oversized = await handleWorkerRequest(new Request("https://worker.example.workers.dev/api/ask", {
    method: "POST",
    headers: { origin: pageOrigin, "content-type": "application/json" },
    body: `{"question":"${"q".repeat(16 * 1024)}"}`,
  }), env, fetcher);
  const tooLong = await handleWorkerRequest(askRequest("q".repeat(4001)), env, fetcher);

  assert.equal(oversized.status, 413);
  assert.equal(await oversized.text(), JSON.stringify({ error: "Request body is too large." }));
  assert.equal(tooLong.status, 400);
  assert.equal(await tooLong.text(), JSON.stringify({ error: "Question must contain 1 to 4000 characters." }));
});

test("returns 429 when the Cloudflare rate-limit binding rejects the client", async () => {
  const response = await handleWorkerRequest(askRequest("hello"), environment([false]));

  assert.equal(response.status, 429);
  assert.equal(await response.text(), JSON.stringify({ error: "Too many requests. Try again later." }));
  assert.equal(response.headers.get("retry-after"), "60");
});

test("redacts provider errors and never returns the Worker secret", async () => {
  const response = await handleWorkerRequest(askRequest("hello"), environment(), async () => {
    throw new Error("provider detail test-secret");
  });
  const body = await response.text();

  assert.equal(response.status, 500);
  assert.equal(body, JSON.stringify({ error: "The answer could not be generated. Please try again." }));
  assert.doesNotMatch(body, /provider detail|test-secret/);
});

test("returns a generic error without calling Groq when the Worker secret is missing", async () => {
  const env = environment();
  delete env.GROQ_API_KEY;
  let providerCalls = 0;
  const response = await handleWorkerRequest(askRequest("hello"), env, async () => {
    providerCalls += 1;
    throw new Error("Groq must not be called without its key.");
  });

  assert.equal(response.status, 500);
  assert.equal(await response.text(), JSON.stringify({ error: "The answer could not be generated. Please try again." }));
  assert.equal(providerCalls, 0);
});