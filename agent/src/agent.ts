import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { OkfBundle } from "./bundle.js";
import { exportKnowledgeCatalog } from "./catalog-export.js";
import type { ChatMessage, ModelTurn, ToolSpec } from "./completion.js";
import { runAgent, type AgentOptions, type AgentRun, type ToolEvent } from "./core-agent.js";
import { complete } from "./groq.js";

export type { AgentOptions, AgentRun, ToolEvent } from "./core-agent.js";

export async function answerQuestion(
  bundle: OkfBundle,
  question: string,
  options: AgentOptions & { completeTurn?: (messages: ChatMessage[], tools: ToolSpec[]) => Promise<ModelTurn> } = {},
): Promise<AgentRun> {
  const system = await readFile(fileURLToPath(new URL("../prompts/system.md", import.meta.url)), "utf8");
  const model = options.model ?? process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
  return runAgent({
    catalog: exportKnowledgeCatalog(bundle),
    systemPrompt: system,
    completeTurn: options.completeTurn ?? ((messages, availableTools) => complete(messages, availableTools, model)),
  }, question, { ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }), model });
}
