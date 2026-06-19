// Pure conversation-handling helpers for the orchestrator.
//
// These are deliberately free of any I/O, network, or module-level state so
// they can be unit-tested in isolation without booting the Express server.
// `index.js` imports them so the running service and the tests exercise the
// exact same code.

export const DEFAULT_MAX_HISTORY_MESSAGES = 40;

// Keep the conversation from growing without bound. We trim from the front,
// but never start the retained history on an "assistant"/tool turn, since the
// Anthropic API requires tool_use and tool_result blocks to stay paired.
export function trimHistory(messages, maxHistoryMessages = DEFAULT_MAX_HISTORY_MESSAGES) {
  if (messages.length <= maxHistoryMessages) return messages;

  let start = messages.length - maxHistoryMessages;
  while (start < messages.length && messages[start].role !== "user") {
    start++;
  }
  // Also avoid starting on a user turn that only carries tool_result blocks.
  while (
    start < messages.length &&
    Array.isArray(messages[start].content) &&
    messages[start].content.some((b) => b.type === "tool_result")
  ) {
    start++;
  }
  return messages.slice(start);
}

// Map MCP tool definitions onto the Anthropic tool schema.
export function mapMcpToolsToAnthropic(mcpTools) {
  return mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description || "",
    input_schema: tool.inputSchema || { type: "object", properties: {} },
  }));
}
