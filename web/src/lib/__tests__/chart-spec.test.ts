import { describe, expect, it } from "vitest";
import { fallbackSpec, validateSpec, type ChartSpec } from "../chart-spec";
import type { Column, QueryResult } from "../types";

const result = (columns: Column[], rows: QueryResult["rows"]): QueryResult => ({
  kind: "sql",
  assumptions: [],
  confidence: "high",
  truncated: false,
  insights: [],
  queryId: "q1",
  question: "q",
  sql: "SELECT 1",
  explanation: "",
  tablesUsed: [],
  columns,
  rows,
});

const cols: Column[] = [
  { name: "MONTH", type: "date" },
  { name: "STATUS", type: "string" },
  { name: "N", type: "number" },
];
const spec = (p: Partial<ChartSpec>): ChartSpec => ({ queryId: "q1", type: "bar", title: "t", y: ["N"], x: "STATUS", ...p });

describe("validateSpec", () => {
  it("accepts a valid bar", () => expect(validateSpec(spec({}), cols)).toBeNull());
  it("rejects unknown columns and lists the available ones", () => {
    const err = validateSpec(spec({ y: ["REVENUE"] }), cols);
    expect(err).toContain('"REVENUE"');
    expect(err).toContain("MONTH, STATUS, N");
  });
  it("rejects non-numeric y", () => expect(validateSpec(spec({ y: ["STATUS"] }), cols)).toContain("not numeric"));
  it("heatmap needs series", () => expect(validateSpec(spec({ type: "heatmap" }), cols)).toContain("heatmap needs"));
  it("heatmap ok with series", () =>
    expect(validateSpec(spec({ type: "heatmap", series: "MONTH" }), cols)).toBeNull());
  it("pie needs exactly one y", () => expect(validateSpec(spec({ type: "pie", y: ["N", "N"] }), cols)).toContain("pie needs"));
  it("scatter x must be numeric", () => expect(validateSpec(spec({ type: "scatter" }), cols)).toContain("numeric"));
  it("kpi needs one y", () => expect(validateSpec(spec({ type: "kpi", y: [] }), cols)).toContain("kpi needs"));
  it("table always ok", () => expect(validateSpec(spec({ type: "table", y: [], x: undefined }), cols)).toBeNull());
});

describe("fallbackSpec", () => {
  it("single number -> kpi", () =>
    expect(fallbackSpec(result([{ name: "N", type: "number" }], [{ N: 5 }])).type).toBe("kpi"));
  it("date + number -> line", () => {
    const s = fallbackSpec(result([cols[0], cols[2]], [{ MONTH: "2023-01-01", N: 1 }, { MONTH: "2023-02-01", N: 2 }]));
    expect(s.type).toBe("line");
    expect(s.x).toBe("MONTH");
  });
  it("two categories + number -> heatmap", () => {
    const c: Column[] = [{ name: "A", type: "string" }, { name: "B", type: "string" }, cols[2]];
    expect(fallbackSpec(result(c, [{ A: "a", B: "b", N: 1 }, { A: "a", B: "c", N: 2 }])).type).toBe("heatmap");
  });
  it("few categories -> pie, many -> bar", () => {
    const c = [cols[1], cols[2]];
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ STATUS: `s${i}`, N: i }));
    expect(fallbackSpec(result(c, mk(4))).type).toBe("pie");
    expect(fallbackSpec(result(c, mk(10))).type).toBe("bar");
  });
  it("two numbers -> scatter", () => {
    const c: Column[] = [{ name: "PRICE", type: "number" }, { name: "COST", type: "number" }];
    expect(fallbackSpec(result(c, [{ PRICE: 1, COST: 2 }, { PRICE: 3, COST: 4 }])).type).toBe("scatter");
  });
  it("only strings -> table", () =>
    expect(fallbackSpec(result([cols[1]], [{ STATUS: "a" }, { STATUS: "b" }])).type).toBe("table"));
});

describe("comparisons", () => {
  const c2: Column[] = [{ name: "CUR", type: "number" }, { name: "PREV", type: "number" }];
  it("kpi accepts [current, previous]", () =>
    expect(validateSpec(spec({ type: "kpi", y: ["CUR", "PREV"], x: undefined }), c2)).toBeNull());
  it("kpi rejects three y columns", () =>
    expect(validateSpec(spec({ type: "kpi", y: ["CUR", "PREV", "CUR"], x: undefined }), c2)).toContain("kpi needs"));
});

describe("map / funnel / cohort", () => {
  const geo: Column[] = [
    { name: "NAME", type: "string" },
    { name: "LATITUDE", type: "number" },
    { name: "LONGITUDE", type: "number" },
  ];
  it("lat/long columns -> map, even with a name column", () => {
    const s = fallbackSpec(result(geo, [{ NAME: "a", LATITUDE: 1, LONGITUDE: 2 }, { NAME: "b", LATITUDE: 3, LONGITUDE: 4 }]));
    expect(s).toMatchObject({ type: "map", x: "LONGITUDE", y: ["LATITUDE"], series: "NAME" });
  });
  it("map x must be numeric", () =>
    expect(validateSpec(spec({ type: "map", x: "NAME", y: ["LATITUDE"] }), geo)).toContain("numeric"));
  it("map ok", () => expect(validateSpec(spec({ type: "map", x: "LONGITUDE", y: ["LATITUDE"] }), geo)).toBeNull());
  it("funnel needs one y", () =>
    expect(validateSpec(spec({ type: "funnel", y: ["N", "N"] }), cols)).toContain("funnel needs"));
  it("cohort needs series", () => expect(validateSpec(spec({ type: "cohort" }), cols)).toContain("cohort needs"));
  it("cohort ok", () => expect(validateSpec(spec({ type: "cohort", series: "MONTH" }), cols)).toBeNull());
});
