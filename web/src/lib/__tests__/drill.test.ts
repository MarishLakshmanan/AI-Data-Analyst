import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { drillFrom, drillPrompt } from "../chat-tools";

const drill = {
  queryId: "q-1",
  question: "orders by status",
  sql: "SELECT STATUS, COUNT(*) FROM ORDERS GROUP BY STATUS",
  filters: [{ field: "STATUS", value: "Shipped" }],
};
const msg = (metadata?: unknown): UIMessage =>
  ({ id: "1", role: "user", metadata, parts: [{ type: "text", text: "Drill into Status = Shipped" }] }) as UIMessage;

describe("drill metadata", () => {
  it("is read from the last user message", () => expect(drillFrom([msg({ drill })])).toEqual(drill));
  it("is absent for normal messages", () => expect(drillFrom([msg()])).toBeUndefined());
  it("ignores malformed metadata", () => expect(drillFrom([msg({ drill: { queryId: 1 } })])).toBeUndefined());
  it("prompt names the queryId and the filter", () => {
    const p = drillPrompt(drill);
    expect(p).toContain('refinesQueryId="q-1"');
    expect(p).toContain('STATUS = "Shipped"');
    expect(p).toContain("orders by status");
    expect(p).toContain("do NOT ask");
  });
});
