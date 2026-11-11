import { z } from "zod";
import type { Column, QueryResult } from "./types";

export const CHART_TYPES = [
  "bar",
  "line",
  "area",
  "pie",
  "scatter",
  "heatmap",
  "cohort",
  "map",
  "funnel",
  "kpi",
  "table",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const chartSpecSchema = z.object({
  queryId: z.string().describe("The queryId returned by querySnowflake."),
  type: z.enum(CHART_TYPES),
  title: z.string().describe("Short chart title."),
  description: z.string().optional().describe("One-line subtitle."),
  x: z
    .string()
    .optional()
    .describe(
      "Column for the x axis / category / pie slice label / heatmap columns / funnel stage / cohort period index. For map: the LONGITUDE column. Omit for kpi and table.",
    ),
  y: z
    .array(z.string())
    .describe(
      "Numeric column(s) to plot. Heatmap and pie take exactly one. kpi takes one, or two ([current, previous]) to show the change vs the previous period. Empty only for table.",
    ),
  series: z
    .string()
    .optional()
    .describe(
      "Optional categorical column that splits the data into multiple series (heatmap rows, cohort labels, grouped/stacked bars, multi-line). For map: optional label column.",
    ),
  reference: z
    .object({ value: z.number(), label: z.string() })
    .optional()
    .describe("Optional horizontal reference line on bar/line/area charts, e.g. a target or the average."),
  stacked: z.boolean().optional(),
  horizontal: z.boolean().optional().describe("Horizontal bars."),
});
export type ChartSpec = z.infer<typeof chartSpecSchema>;

export interface PinnedChart {
  id: string;
  spec: ChartSpec;
  result: QueryResult;
  size: "sm" | "md" | "lg";
  pinnedAt: number;
  refreshedAt?: number;
}

/** Returns an error message the model can act on, or null when the spec is valid. */
export function validateSpec(spec: ChartSpec, columns: Column[]): string | null {
  const byName = new Map(columns.map((c) => [c.name, c]));
  const names = columns.map((c) => c.name).join(", ");
  const check = (col: string | undefined, what: string) =>
    col !== undefined && !byName.has(col)
      ? `${what} column "${col}" does not exist. Available columns: ${names}.`
      : null;

  for (const err of [
    check(spec.x, "x"),
    check(spec.series, "series"),
    ...spec.y.map((c) => check(c, "y")),
  ]) {
    if (err) return err;
  }
  const nonNumeric = spec.y.find((c) => byName.get(c)?.type !== "number");
  if (nonNumeric) return `y column "${nonNumeric}" is not numeric.`;

  switch (spec.type) {
    case "table":
      return null;
    case "kpi":
      return spec.y.length === 1 || spec.y.length === 2
        ? null
        : "kpi needs one y column, or two ([current, previous]) for a comparison.";
    case "heatmap":
    case "cohort":
      if (!spec.x || !spec.series || spec.y.length !== 1)
        return `${spec.type} needs x, series and exactly one y column.`;
      return null;
    case "funnel":
      if (!spec.x || spec.y.length !== 1) return "funnel needs x (stage) and exactly one y column.";
      return null;
    case "map":
      if (!spec.x || spec.y.length < 1) return "map needs x (longitude) and y[0] (latitude).";
      return byName.get(spec.x)?.type === "number" ? null : "map x (longitude) must be numeric.";
    case "pie":
      if (!spec.x || spec.y.length !== 1) return "pie needs x and exactly one y column.";
      return null;
    case "scatter":
      if (!spec.x || spec.y.length < 1) return "scatter needs x and at least one y column.";
      return byName.get(spec.x)?.type === "number" ? null : "scatter x must be numeric.";
    default:
      if (!spec.x || spec.y.length < 1) return `${spec.type} needs x and at least one y column.`;
      return null;
  }
}

/** Heuristic chart choice, used when the model does not (or cannot) pick one. */
export function fallbackSpec(result: QueryResult): ChartSpec {
  const { columns, rows, queryId } = result;
  const nums = columns.filter((c) => c.type === "number");
  const dates = columns.filter((c) => c.type === "date");
  const cats = columns.filter((c) => c.type === "string" || c.type === "boolean");
  const base = { queryId, title: result.question, y: [] as string[] };

  // Coordinates -> map (checked first: a place name + lat/long would otherwise become a bar chart).
  const lat = nums.find((c) => /^lat(itude)?$/i.test(c.name));
  const lon = nums.find((c) => /^(lon|lng|long|longitude)$/i.test(c.name));
  if (lat && lon && rows.length) {
    const size = nums.find((c) => c !== lat && c !== lon && !/^id$/i.test(c.name));
    return { ...base, type: "map", x: lon.name, y: size ? [lat.name, size.name] : [lat.name], series: cats[0]?.name };
  }

  if (rows.length === 1 && nums.length === 1 && columns.length <= 2)
    return { ...base, type: "kpi", y: [nums[0].name] };
  if (dates.length && nums.length)
    return { ...base, type: "line", x: dates[0].name, y: nums.map((c) => c.name).slice(0, 3) };
  if (cats.length >= 2 && nums.length >= 1 && rows.length > 1)
    return { ...base, type: "heatmap", x: cats[0].name, series: cats[1].name, y: [nums[0].name] };
  if (cats.length && nums.length)
    return rows.length <= 6 && nums.length === 1
      ? { ...base, type: "pie", x: cats[0].name, y: [nums[0].name] }
      : { ...base, type: "bar", x: cats[0].name, y: nums.map((c) => c.name).slice(0, 3) };
  if (nums.length >= 2)
    return { ...base, type: "scatter", x: nums[0].name, y: [nums[1].name] };
  return { ...base, type: "table" };
}
