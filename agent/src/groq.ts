import "dotenv/config";
import Groq from "groq-sdk";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import type { ChatMessage, ModelTurn, ToolSpec } from "./completion.js";

export type { ChatMessage, ModelTurn, ToolSpec } from "./completion.js";

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export function serializeMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message) => {
    switch (message.role) {
      case "system": return { role: "system", content: message.content ?? "" };
      case "user": return { role: "user", content: message.content ?? "" };
      case "assistant": return {
        role: "assistant",
        content: message.content,
        ...(message.reasoning !== undefined ? { reasoning: message.reasoning } : {}),
        ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
      };
      case "tool": return {
        role: "tool",
        tool_call_id: message.tool_call_id ?? "",
        content: message.content ?? "",
      };
    }
  });
}

export async function complete(messages: ChatMessage[], tools: ToolSpec[], modelOverride?: string): Promise<ModelTurn> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set. Add it to .env before running ask or eval.");
  const model = modelOverride ?? process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
  const client = new Groq({ apiKey });
  const normalizedTools = tools.map((tool) => ({
    ...tool,
    function: {
      ...tool.function,
      parameters: {
        ...tool.function.parameters,
        additionalProperties: false,
      },
    },
  }));
  const response = await client.chat.completions.create({
    model,
    messages: serializeMessages(messages),
    tools: normalizedTools,
    tool_choice: "auto",
    temperature: 0,
    include_reasoning: false,
    reasoning_effort: "low",
  });
  const choice = response.choices[0];
  if (!choice) throw new Error("Groq returned no completion choice.");
  return {
    content: choice.message.content,
    reasoning: choice.message.reasoning ?? null,
    toolCalls: (choice.message.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    })),
    finishReason: choice.finish_reason ?? "unknown",
    inputTokens: nonnegativeInteger(response.usage?.prompt_tokens),
    outputTokens: nonnegativeInteger(response.usage?.completion_tokens),
  };
}
