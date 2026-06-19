import { describe, it, expect } from "vitest";
import {
  trimHistory,
  mapMcpToolsToAnthropic,
  DEFAULT_MAX_HISTORY_MESSAGES,
} from "./conversation.js";

// Small helpers to build message fixtures that look like the real
// Anthropic conversation shapes the orchestrator stores.
const userText = (text) => ({ role: "user", content: text });
const assistantText = (text) => ({ role: "assistant", content: [{ type: "text", text }] });
const toolResultTurn = (id) => ({
  role: "user",
  content: [{ type: "tool_result", tool_use_id: id, content: "ok" }],
});

describe("trimHistory", () => {
  it("returns the history untouched when at or below the cap", () => {
    const messages = [userText("a"), assistantText("b")];
    expect(trimHistory(messages, 40)).toBe(messages);
  });

  it("trims from the front when the history exceeds the cap", () => {
    // 41 simple user turns, cap of 40 -> exactly one should be dropped.
    const messages = Array.from({ length: 41 }, (_, i) => userText(`m${i}`));
    const result = trimHistory(messages, 40);
    expect(result).toHaveLength(40);
    expect(result[0]).toEqual(userText("m1"));
  });

  it("never starts the retained window on an assistant turn", () => {
    // Build an over-cap history whose natural cut point lands on an assistant
    // turn; trimHistory must advance forward to the next user turn.
    const messages = [
      assistantText("oldest"), // would be the raw slice start
      userText("keep-me"),
      ...Array.from({ length: 40 }, (_, i) => userText(`m${i}`)),
    ];
    const result = trimHistory(messages, 40);
    expect(result[0].role).toBe("user");
  });

  it("never starts the retained window on a tool_result-only user turn", () => {
    const messages = [
      toolResultTurn("t1"), // raw slice start, but tool_result-only
      userText("real-user-turn"),
      ...Array.from({ length: 40 }, (_, i) => userText(`m${i}`)),
    ];
    const result = trimHistory(messages, 40);
    const firstContent = result[0].content;
    const startsWithToolResult =
      Array.isArray(firstContent) && firstContent.some((b) => b.type === "tool_result");
    expect(startsWithToolResult).toBe(false);
  });

  it("defaults to DEFAULT_MAX_HISTORY_MESSAGES when no cap is provided", () => {
    const messages = Array.from(
      { length: DEFAULT_MAX_HISTORY_MESSAGES + 5 },
      (_, i) => userText(`m${i}`)
    );
    expect(trimHistory(messages)).toHaveLength(DEFAULT_MAX_HISTORY_MESSAGES);
  });
});

describe("mapMcpToolsToAnthropic", () => {
  it("maps name, description, and inputSchema onto the Anthropic shape", () => {
    const mcpTools = [
      {
        name: "create_kanban_task",
        description: "Create a task",
        inputSchema: { type: "object", properties: { subject: { type: "string" } } },
      },
    ];
    expect(mapMcpToolsToAnthropic(mcpTools)).toEqual([
      {
        name: "create_kanban_task",
        description: "Create a task",
        input_schema: { type: "object", properties: { subject: { type: "string" } } },
      },
    ]);
  });

  it("falls back to an empty description and an empty object schema", () => {
    const result = mapMcpToolsToAnthropic([{ name: "bare" }]);
    expect(result[0].description).toBe("");
    expect(result[0].input_schema).toEqual({ type: "object", properties: {} });
  });
});
