import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { answerQuestion, type AgentRun } from "./agent.js";
import type { OkfBundle } from "./bundle.js";

const maxBodyBytes = 16 * 1024;
const questionSchema = z.object({ question: z.string().trim().min(1).max(4000) });
const hostSchema = z.string().regex(/^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/);
const assetPaths = {
  "/": ["../web/index.html", "text/html; charset=utf-8"],
  "/app.js": ["../web/app.js", "text/javascript; charset=utf-8"],
  "/theme.js": ["../web/theme.js", "text/javascript; charset=utf-8"],
  "/vendor/marked.js": ["../../node_modules/marked/lib/marked.esm.js", "text/javascript; charset=utf-8"],
  "/vendor/purify.es.mjs": ["../../node_modules/dompurify/dist/purify.es.mjs", "text/javascript; charset=utf-8"],
  "/styles.css": ["../web/styles.css", "text/css; charset=utf-8"],
} as const;

export type GuiOptions = {
  port?: number;
  ask?: (question: string) => Promise<AgentRun>;
};

function respond(response: ServerResponse, status: number, body: string, contentType = "application/json; charset=utf-8"): void {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
}

function isLoopbackAuthority(authority: string, port: number): boolean {
  try {
    const url = new URL(`http://${authority}`);
    return (url.hostname === "127.0.0.1" || url.hostname === "localhost")
      && url.port === String(port)
      && url.username === "" && url.password === ""
      && url.pathname === "/" && url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}

function allowedRequest(request: IncomingMessage, port: number): boolean {
  const host = request.headers.host;
  if (!host || !hostSchema.safeParse(host.toLowerCase()).success || !isLoopbackAuthority(host.toLowerCase(), port)) return false;
  const origin = request.headers.origin;
  if (origin === undefined) return request.method === "GET" || request.method === "HEAD";
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:"
      && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
      && parsed.port === String(port)
      && parsed.host === host.toLowerCase()
      && parsed.username === "" && parsed.password === ""
      && parsed.pathname === "/" && parsed.search === "" && parsed.hash === "";
  } catch {
    return false;
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBodyBytes) throw new RangeError("Request body too large.");
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return parsed;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  port: number,
  ask: NonNullable<GuiOptions["ask"]>,
  assets: Map<string, { content: string; contentType: string }>,
): Promise<void> {
  if (!allowedRequest(request, port)) {
    respond(response, 403, JSON.stringify({ error: "Request host or origin is not allowed." }));
    return;
  }

  let pathname: string;
  try {
    pathname = new URL(request.url ?? "/", `http://127.0.0.1:${port}`).pathname;
  } catch {
    respond(response, 400, JSON.stringify({ error: "Invalid request." }));
    return;
  }

  if (pathname === "/api/ask") {
    if (request.method !== "POST") {
      respond(response, 405, JSON.stringify({ error: "Method not allowed." }));
      return;
    }
    if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      respond(response, 415, JSON.stringify({ error: "Content-Type must be application/json." }));
      return;
    }
    let input: unknown;
    try {
      input = await readJson(request);
    } catch (error) {
      respond(response, error instanceof RangeError ? 413 : 400, JSON.stringify({ error: error instanceof RangeError ? "Request body is too large." : "Invalid JSON request." }));
      return;
    }
    const parsed = questionSchema.safeParse(input);
    if (!parsed.success) {
      respond(response, 400, JSON.stringify({ error: "Question must contain 1 to 4000 characters." }));
      return;
    }
    try {
      const run = await ask(parsed.data.question);
      respond(response, 200, JSON.stringify({ run }));
    } catch {
      respond(response, 500, JSON.stringify({ error: "The answer could not be generated. Please try again." }));
    }
    return;
  }

  const asset = assets.get(pathname);
  if (!asset) {
    respond(response, 404, JSON.stringify({ error: "Not found." }));
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    respond(response, 405, JSON.stringify({ error: "Method not allowed." }));
    return;
  }
  if (request.method === "HEAD") {
    response.writeHead(200, { "content-type": asset.contentType, "cache-control": "no-store", "x-content-type-options": "nosniff" });
    response.end();
    return;
  }
  respond(response, 200, asset.content, asset.contentType);
}

export async function startGui(bundle: OkfBundle, options: GuiOptions = {}): Promise<Server> {
  const port = options.port ?? 4317;
  const ask = options.ask ?? ((question) => answerQuestion(bundle, question, {
    maxSteps: Number(process.env.MAX_AGENT_STEPS ?? "10"),
    ...(process.env.GROQ_MODEL ? { model: process.env.GROQ_MODEL } : {}),
  }));
  const assets = new Map<string, { content: string; contentType: string }>();
  for (const [route, [path, contentType]] of Object.entries(assetPaths)) {
    assets.set(route, { content: await readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8"), contentType });
  }

  let boundPort = port;
  const server = createServer((request, response) => {
    void handleRequest(request, response, boundPort, ask, assets).catch(() => {
      if (!response.headersSent) respond(response, 500, JSON.stringify({ error: "The request could not be completed." }));
      else response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not determine GUI server address."));
        return;
      }
      boundPort = address.port;
      resolve();
    });
  });
  return server;
}
