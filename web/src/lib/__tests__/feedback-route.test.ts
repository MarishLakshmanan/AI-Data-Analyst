import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/feedback/route";

const call = (body: unknown) =>
  POST(new Request("http://x/api/feedback", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

afterEach(() => vi.unstubAllGlobals());

describe("POST /api/feedback", () => {
  it("forwards a cleaned payload to FastAPI /feedback", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 7 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await call({
      question: "q",
      sql: "SELECT 1",
      assumptions: ["a", 5, "b"],
      rating: "down",
      comment: "  wrong  ",
      extra: "ignored",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 7 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/feedback$/);
    expect(JSON.parse(init.body)).toEqual({
      question: "q",
      sql: "SELECT 1",
      assumptions: ["a", "b"],
      rating: "down",
      comment: "  wrong  ",
    });
  });

  it("omits a blank comment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1 })));
    vi.stubGlobal("fetch", fetchMock);
    await call({ question: "q", sql: "s", rating: "up", comment: "   " });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).comment).toBeUndefined();
  });

  it.each([
    ["bad rating", { question: "q", sql: "s", rating: "meh" }],
    ["missing sql", { question: "q", rating: "up" }],
    ["not json", "{nope"],
  ])("400s on %s without calling FastAPI", async (_n, body) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await call(body)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("502s with a readable error when FastAPI rejects it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "bad" }), { status: 422 })));
    const res = await call({ question: "q", sql: "s", rating: "up" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("bad");
  });
});
