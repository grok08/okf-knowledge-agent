import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { OkfBundle } from "./bundle.js";
import { complete, type ChatMessage, type ModelTurn, type ToolSpec } from "./groq.js";
import { conceptTypes } from "./types.js";

const tools: ToolSpec[] = [
  { type: "function", function: { name: "list_concepts", description: "List concepts, optionally filtered by type. For questions asking which services InfoMagnus provides, call with type Service. Use null only to list every type.", strict: true, parameters: { type: "object", properties: { type: { type: ["string", "null"], enum: [...conceptTypes, null] } }, required: ["type"], additionalProperties: false } } },
  { type: "function", function: { name: "search_concepts", description: "Search concept title, type, description, and tags using local lexical matching.", strict: true, parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "read_concept", description: "Read a concept and its evidence by bundle-relative path.", strict: true, parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } } },
  { type: "function", function: { name: "follow_links", description: "Follow declared concept links from a bundle-relative path.", strict: true, parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } } },
];

export type ToolEvent = { name: string; arguments: unknown; result: unknown };
export type AgentRun = {
  question: string;
  answer: string;
  toolCalls: ToolEvent[];
  conceptsDiscovered: string[];
  conceptsRead: string[];
  linksFollowed: number;
  sources: string[];
  unsupportedCitations: string[];
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  stop: "completed" | "step-limit";
  model: string;
};

export type AgentOptions = {
  maxSteps?: number;
  completeTurn?: (messages: ChatMessage[], tools: ToolSpec[]) => Promise<ModelTurn>;
  model?: string;
};

function parseArguments(input: string): Record<string, unknown> {
  const value: unknown = JSON.parse(input);
  return z.record(z.string(), z.unknown()).parse(value);
}

function stringArgument(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Tool argument ${name} must be a non-empty string.`);
  return value;
}

async function executeTool(bundle: OkfBundle, name: string, raw: string, sources: Set<string>): Promise<unknown> {
  const args = parseArguments(raw);
  switch (name) {
    case "list_concepts": {
      const type = args.type;
      if (type !== undefined && type !== null && typeof type !== "string") throw new Error("type must be a string or null.");
      const parsedType = typeof type === "string" ? z.enum(conceptTypes).parse(type) : undefined;
      return bundle.list(parsedType).map(({ path, type: conceptType, title, description }) => ({ path: relative(bundle.root, path).split(sep).join("/"), type: conceptType, title, description }));
    }
    case "search_concepts": return bundle.search(stringArgument(args, "query"));
    case "read_concept": {
      const concept = bundle.read(stringArgument(args, "path"));
      if (!concept) return { error: "Concept not found." };
      const evidence = [concept.evidence, ...concept.relations.map((relation) => relation.evidence)];
      for (const source of new Set(evidence.map((item) => item.source))) sources.add(source);
      return { ...concept, path: relative(bundle.root, concept.path).split(sep).join("/") };
    }
    case "follow_links": {
      const path = stringArgument(args, "path");
      const source = bundle.read(path);
      return source ? source.relations.flatMap((relation) => {
        const target = bundle.read(relation.target);
        return target ? [{ path: relative(bundle.root, target.path).split(sep).join("/"), type: target.type, title: target.title, relation: relation.kind, evidence: relation.evidence }] : [];
      }) : [];
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

export async function answerQuestion(bundle: OkfBundle, question: string, options: AgentOptions = {}): Promise<AgentRun> {
  const system = await readFile(fileURLToPath(new URL("../prompts/system.md", import.meta.url)), "utf8");
  const maxSteps = options.maxSteps ?? 10;
  const completeTurn = options.completeTurn ?? ((messages, availableTools) => complete(messages, availableTools, options.model));
  const start = Date.now();
  const messages: ChatMessage[] = [{ role: "system", content: system }, { role: "user", content: question }];
  const toolCalls: ToolEvent[] = [];
  const conceptsDiscovered = new Set<string>();
  const conceptsRead = new Set<string>();
  const sources = new Set<string>();
  let linksFollowed = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let hasInputUsage = false;
  let hasOutputUsage = false;
  let answer = "";
  let stop: AgentRun["stop"] = "step-limit";
  for (let step = 0; step < maxSteps; step += 1) {
    const turn: ModelTurn = await completeTurn(messages, tools);
    if (turn.inputTokens !== null) { inputTokens += turn.inputTokens; hasInputUsage = true; }
    if (turn.outputTokens !== null) { outputTokens += turn.outputTokens; hasOutputUsage = true; }
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: turn.content,
      reasoning: turn.reasoning,
      ...(turn.toolCalls.length ? { tool_calls: turn.toolCalls.map((call) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: call.arguments } })) } : {}),
    };
    messages.push(assistantMessage);
    if (turn.toolCalls.length === 0) {
      answer = toolCalls.length > 0
        ? turn.content ?? "The model returned no answer."
        : "No OKF knowledge tools were used, so I cannot provide an answer from the bundle.";
      stop = "completed";
      break;
    }
    for (const call of turn.toolCalls) {
      let result: unknown;
      try {
        result = await executeTool(bundle, call.name, call.arguments, sources);
      } catch (error) {
        result = { error: error instanceof Error ? error.message : "Tool execution failed." };
      }
      const args = (() => { try { return parseArguments(call.arguments); } catch { return {}; } })();
      if (call.name === "read_concept" && typeof args.path === "string") {
        conceptsRead.add(args.path);
        const concept = bundle.read(args.path);
        if (concept) sources.add(concept.resource);
      }
      toolCalls.push({ name: call.name, arguments: args, result });
      if (Array.isArray(result)) {
        for (const item of result) {
          if (typeof item === "object" && item !== null && "path" in item && typeof item.path === "string") conceptsDiscovered.add(item.path);
        }
      }
      if (call.name === "follow_links" && Array.isArray(result)) {
        linksFollowed += result.length;
        for (const item of result) {
          if (typeof item === "object" && item !== null && "path" in item && typeof item.path === "string") conceptsDiscovered.add(item.path);
        }
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  if (stop === "step-limit" && answer.length === 0) answer = "The agent reached the tool-step limit before the model returned a final answer.";
  const citedUrls = answer.match(/https?:\/\/[^\s)\]>"']+/g) ?? [];
  const unsupportedCitations = [...new Set(citedUrls.filter((url) => !sources.has(url.replace(/[.,;!?]+$/, ""))))];
  return {
    question,
    answer,
    toolCalls,
    conceptsDiscovered: [...conceptsDiscovered],
    conceptsRead: [...conceptsRead],
    linksFollowed,
    sources: [...sources],
    unsupportedCitations,
    latencyMs: Date.now() - start,
    inputTokens: hasInputUsage ? inputTokens : null,
    outputTokens: hasOutputUsage ? outputTokens : null,
    stop,
    model: options.model ?? process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
  };
}
