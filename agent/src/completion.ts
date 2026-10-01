export type ToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown>; strict?: boolean };
};

export type ModelTurn = {
  content: string | null;
  reasoning: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  finishReason: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  reasoning?: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
};