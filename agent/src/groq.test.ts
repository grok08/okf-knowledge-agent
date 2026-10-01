import assert from "node:assert/strict";
import test from "node:test";
import { serializeMessages } from "./groq.js";

test("Groq message serialization preserves reasoning and tool names across tool-call turns", () => {
  const messages = serializeMessages([
    { role: "assistant", content: null, reasoning: "Find the relevant concept.", tool_calls: [{
      id: "call-1",
      type: "function",
      function: { name: "search_concepts", arguments: "{\"query\":\"services\"}" },
    }] },
    { role: "tool", tool_call_id: "call-1", content: "[]" },
  ]);

  assert.equal(messages[0]?.role, "assistant");
  if (messages[0]?.role === "assistant") {
    assert.equal(messages[0].reasoning, "Find the relevant concept.");
    assert.equal(messages[0].tool_calls?.[0]?.function.name, "search_concepts");
  } else {
    assert.fail("Expected the first message to remain an assistant message.");
  }
  assert.equal(messages[1]?.role, "tool");
  if (messages[1]?.role === "tool") {
    assert.equal(messages[1].tool_call_id, "call-1");
  } else {
    assert.fail("Expected the second message to remain a tool result.");
  }
});
