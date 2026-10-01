import { z } from "zod";
import { parseKnowledgeCatalog, type KnowledgeCatalog } from "./catalog.js";
import type { ChatMessage, ModelTurn, ToolSpec } from "./completion.js";
import { runAgent } from "./core-agent.js";

const maxBodyBytes = 16 * 1024;
const questionSchema = z.object({ question: z.string().trim().min(1).max(4000) });
const groqResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string().nullable().optional(),
      reasoning: z.string().nullable().optional(),
      tool_calls: z.array(z.object({
        id: z.string(),
        function: z.object({ name: z.string(), arguments: z.string() }),
      })).optional(),
    }),
    finish_reason: z.string().nullable().optional(),
  })),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).optional(),
});

export type RateLimitBinding = { limit: (input: { key: string }) => Promise<{ success: boolean }> };
export type WorkerEnvironment = {
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  PAGES_ORIGIN: string;
  ASSETS: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
  RATE_LIMITER: RateLimitBinding;
};

type WorkerData = { catalog: KnowledgeCatalog; systemPrompt: string };
const workerDataCache = new WeakMap<object, Promise<WorkerData>>();

function apiHeaders(origin: string): HeadersInit {
  return {
    "access-control-allow-origin": origin,
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "vary": "Origin",
    "x-content-type-options": "nosniff",
  };
}

function jsonResponse(origin: string, status: number, value: unknown, additionalHeaders: HeadersInit = {}): Response {
  const headers = new Headers(apiHeaders(origin));
  new Headers(additionalHeaders).forEach((value, name) => headers.set(name, value));
  return new Response(JSON.stringify(value), { status, headers });
}

function errorResponse(origin: string, status: number, error: string, additionalHeaders?: HeadersInit): Response {
  return jsonResponse(origin, status, { error }, additionalHeaders);
}

async function readBody(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBodyBytes) throw new RangeError("Request body is too large.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function loadWorkerData(environment: WorkerEnvironment, requestUrl: string): Promise<WorkerData> {
  const cached = workerDataCache.get(environment.ASSETS);
  if (cached) return cached;
  const loading = Promise.all([
    environment.ASSETS.fetch(new URL("/knowledge-catalog.json", requestUrl)),
    environment.ASSETS.fetch(new URL("/system-prompt.md", requestUrl)),
  ]).then(async ([catalogResponse, promptResponse]) => {
    if (!catalogResponse.ok || !promptResponse.ok) {
      console.error("Worker data assets returned unsuccessful responses", {
        catalogStatus: catalogResponse.status,
        promptStatus: promptResponse.status,
      });
      throw new Error("Worker data could not be loaded.");
    }
    const input: unknown = await catalogResponse.json();
    return { catalog: parseKnowledgeCatalog(input), systemPrompt: await promptResponse.text() };
  });
  workerDataCache.set(environment.ASSETS, loading);
  void loading.catch(() => {
    if (workerDataCache.get(environment.ASSETS) === loading) workerDataCache.delete(environment.ASSETS);
  });
  return loading;
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

async function completeWithGroq(
  messages: ChatMessage[],
  tools: ToolSpec[],
  environment: WorkerEnvironment,
  fetcher: typeof fetch,
): Promise<ModelTurn> {
  if (!environment.GROQ_API_KEY) {
    console.error("GROQ_API_KEY is not bound in the Worker.");
    throw new Error("Groq API key is unavailable.");
  }
  let response: Response;
  try {
    response = await fetcher("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${environment.GROQ_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: environment.GROQ_MODEL ?? "openai/gpt-oss-120b",
        messages,
        tools: tools.map((tool) => ({
          ...tool,
          function: { ...tool.function, parameters: { ...tool.function.parameters, additionalProperties: false } },
        })),
        tool_choice: "auto",
        temperature: 0,
        include_reasoning: false,
        reasoning_effort: "low",
      }),
    });
  } catch (error) {
    console.error("Groq request failed before receiving a response", error instanceof Error ? error.name : "UnknownError");
    throw new Error("Groq completion failed.");
  }
  if (!response.ok) {
    console.error("Groq API returned an unsuccessful status", response.status);
    throw new Error("Groq completion failed.");
  }
  let input: unknown;
  try {
    input = await response.json();
  } catch (error) {
    console.error("Groq API returned invalid JSON", error instanceof Error ? error.name : "UnknownError");
    throw new Error("Groq completion failed.");
  }
  let result: z.infer<typeof groqResponseSchema>;
  try {
    result = groqResponseSchema.parse(input);
  } catch {
    console.error("Groq API response did not match the expected schema.");
    throw new Error("Groq completion failed.");
  }
  const choice = result.choices[0];
  if (!choice) throw new Error("Groq returned no completion choice.");
  return {
    content: choice.message.content ?? null,
    reasoning: choice.message.reasoning ?? null,
    toolCalls: (choice.message.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    })),
    finishReason: choice.finish_reason ?? "unknown",
    inputTokens: nonnegativeInteger(result.usage?.prompt_tokens),
    outputTokens: nonnegativeInteger(result.usage?.completion_tokens),
  };
}

export async function handleWorkerRequest(
  request: Request,
  environment: WorkerEnvironment,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const origin = request.headers.get("origin");
  if (!origin || origin !== environment.PAGES_ORIGIN) {
    return new Response(JSON.stringify({ error: "Request origin is not allowed." }), {
      status: 403,
      headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" },
    });
  }

  const url = new URL(request.url);
  if (url.pathname !== "/api/ask") return errorResponse(origin, 404, "Not found.");
  if (request.method === "OPTIONS") {
    const requestedMethod = request.headers.get("access-control-request-method");
    const requestedHeaders = request.headers.get("access-control-request-headers")?.split(",").map((header) => header.trim().toLowerCase()) ?? [];
    if (requestedMethod !== "POST" || requestedHeaders.some((header) => header !== "content-type")) {
      return errorResponse(origin, 403, "Preflight request is not allowed.");
    }
    return new Response(null, {
      status: 204,
      headers: {
        ...apiHeaders(origin),
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-max-age": "600",
      },
    });
  }
  if (request.method !== "POST") return errorResponse(origin, 405, "Method not allowed.");
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return errorResponse(origin, 415, "Content-Type must be application/json.");
  }

  const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
  try {
    const rateLimit = await environment.RATE_LIMITER.limit({ key: clientIp });
    if (!rateLimit.success) return errorResponse(origin, 429, "Too many requests. Try again later.", { "retry-after": "60" });
  } catch {
    return errorResponse(origin, 503, "The answer service is temporarily unavailable.");
  }

  let rawBody: string;
  try {
    rawBody = await readBody(request);
  } catch (error) {
    return errorResponse(origin, error instanceof RangeError ? 413 : 400, error instanceof RangeError ? "Request body is too large." : "Invalid JSON request.");
  }

  let input: unknown;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return errorResponse(origin, 400, "Invalid JSON request.");
  }
  const parsed = questionSchema.safeParse(input);
  if (!parsed.success) return errorResponse(origin, 400, "Question must contain 1 to 4000 characters.");

  let stage = "loading the knowledge catalog";
  try {
    const { catalog, systemPrompt } = await loadWorkerData(environment, request.url);
    const model = environment.GROQ_MODEL ?? "openai/gpt-oss-120b";
    stage = "running the answer agent";
    const run = await runAgent({
      catalog,
      systemPrompt,
      completeTurn: (messages, tools) => completeWithGroq(messages, tools, environment, fetcher),
    }, parsed.data.question, { maxSteps: 6, model });
    return jsonResponse(origin, 200, { run });
  } catch (error) {
    console.error("Worker answer generation failed while", stage, error instanceof Error ? error.name : "UnknownError");
    return errorResponse(origin, 500, "The answer could not be generated. Please try again.");
  }
}

export default {
  fetch(request: Request, environment: WorkerEnvironment): Promise<Response> {
    return handleWorkerRequest(request, environment);
  },
};