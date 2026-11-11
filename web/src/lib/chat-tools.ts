import { tool, type UIMessage } from "ai";
import { z } from "zod";
import { chartSpecSchema, validateSpec } from "./chart-spec";
import { queryPython } from "./python-api";
import type { QueryOutput, QueryResult } from "./types";

export const SYSTEM_PROMPT = `You are a data analyst for an e-commerce company. You answer questions by querying Snowflake and visualising the result.

Workflow for every data question:
1. Call querySnowflake with the user's question in plain English (a separate agent writes the SQL). Do not write SQL yourself.
   If the user narrows, re-splits or re-scales the previous result ("only 2024", "split by gender", "as a percentage", "now by brand", "drill into X"), pass refinesQueryId with that result's queryId and describe just the change. A new topic gets no refinesQueryId.
2. Call renderChart with the returned queryId. Use ONLY column names listed in the tool result. Choose the chart by the shape of the data:
   - one date/time column + numeric column(s) -> line (area for cumulative/volume)
   - one category + one numeric, up to ~15 rows -> bar (pie only if <= 6 parts of a whole)
   - two categories + one numeric -> heatmap (x = one category, series = the other)
   - latitude + longitude columns -> map (x = longitude, y = [latitude] or [latitude, size column], series = optional label column)
   - ordered stages with decreasing counts (e.g. viewed -> carted -> purchased) -> funnel (x = stage, y = [count])
   - cohort retention (cohort label, period index, retention %) -> cohort (x = period index, series = cohort label, y = [percentage])
   - two other numeric columns -> scatter
   - a single value -> kpi; a single row with a current and a previous value (e.g. this month vs last) -> kpi with y = [current, previous] to show the % change
   - to mark a target or the average on bar/line/area, add reference {value, label}
   - anything else, or many columns -> table
3. Finish with 1-2 sentences of insight. Base numbers ONLY on the "insights" list and sampleRows: those facts were computed in code, so never estimate or invent figures. Never repeat the raw rows; the UI already shows them.
If querySnowflake returns kind "clarification", relay its message to the user in one short sentence and STOP: do not call renderChart. The UI shows the options as buttons.
Mention assumptions or truncation (truncated: true means only the first 1000 rows were returned) in your insight when they matter.
If a tool returns an error, fix the input and retry once, otherwise explain the problem briefly. For compound questions, run several query/chart pairs.`;

/** Query results from earlier turns, recovered from the UI messages the client sends back. */
function knownResults(messages: UIMessage[]): Map<string, QueryResult> {
  const known = new Map<string, QueryResult>();
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === "tool-querySnowflake" && "output" in p && p.output) {
        const r = p.output as QueryOutput;
        if (r.kind === "sql" || r.kind === undefined) known.set(r.queryId, r as QueryResult);
      }
    }
  }
  return known;
}

export type DrillMeta = {
  queryId: string;
  question: string;
  sql: string;
  filters: { field: string; value: string }[];
};

/** Drill-down requests carry the clicked result's question + SQL in message metadata. */
export function drillFrom(messages: UIMessage[]): DrillMeta | undefined {
  const last = messages.at(-1);
  const d = (last?.role === "user" ? (last.metadata as { drill?: DrillMeta } | undefined)?.drill : undefined);
  return d && typeof d.queryId === "string" && typeof d.sql === "string" && Array.isArray(d.filters) ? d : undefined;
}

export function drillPrompt(d: DrillMeta): string {
  const f = d.filters.map((x) => `${x.field} = "${x.value}"`).join(" AND ");
  return `

DRILL-DOWN REQUEST. The user clicked a chart and wants to drill into ${f}.
That chart came from the question "${d.question}" (queryId ${d.queryId}). Its SQL is stored server-side even if it does not appear earlier in this conversation, so do NOT ask the user for more context.
You MUST immediately call querySnowflake with refinesQueryId="${d.queryId}" and a question that restricts to exactly ${f} and breaks it down by the most useful next dimension (over time if the previous result had no time axis, otherwise another category). Then call renderChart.`;
}

export function createTools(messages: UIMessage[]) {
  const known = knownResults(messages);
  // Charts pinned in an earlier session are not in this conversation; the drill metadata carries them.
  const drill = drillFrom(messages);
  const previous = (id: string) =>
    known.get(id) ?? (drill && drill.queryId === id ? { question: drill.question, sql: drill.sql } : undefined);
  return {
    querySnowflake: tool({
      description:
        "Answer a business question with data. A SQL agent writes and runs a read-only Snowflake query. Returns queryId, columns, row count and a few sample rows.",
      inputSchema: z.object({
        question: z.string().describe("The data question in plain English. For follow-ups, only the change requested, e.g. 'only 2024'."),
        refinesQueryId: z
          .string()
          .optional()
          .describe("queryId of the earlier result this builds on (narrowing, re-splitting, re-scaling, drilling down). Omit for a new topic."),
      }),
      execute: async ({ question, refinesQueryId }): Promise<QueryOutput> => {
        // During a drill-down the clicked chart is always the base, even if the model forgets to say so.
        const baseId = refinesQueryId ?? drill?.queryId;
        const prev = baseId ? previous(baseId) : undefined;
        const result = await queryPython(question, prev && { question: prev.question, sql: prev.sql });
        if (result.kind === "sql") known.set(result.queryId, result);
        return result;
      },
      // The model only sees a summary; the UI receives the full rows via the message part.
      toModelOutput: ({ output }) => {
        const r = output as QueryOutput;
        if (r.kind === "clarification")
          return {
            type: "json",
            value: { kind: "clarification", message: r.message, options: r.options },
          };
        return {
          type: "json",
          value: {
            kind: "sql",
            queryId: r.queryId,
            columns: r.columns,
            rowCount: r.rows.length,
            truncated: r.truncated,
            insights: r.insights.map((i) => i.text),
            sampleRows: r.rows.slice(0, 5),
            sql: r.sql,
            explanation: r.explanation,
            assumptions: r.assumptions,
            confidence: r.confidence,
          },
        };
      },
    }),
    renderChart: tool({
      description:
        "Render a chart for a previous querySnowflake result. The UI looks up the rows by queryId; never pass data here.",
      inputSchema: chartSpecSchema,
      execute: async (spec) => {
        const result = known.get(spec.queryId);
        if (!result) return { ok: false as const, error: `Unknown queryId ${spec.queryId}.` };
        const error = validateSpec(spec, result.columns);
        if (error) return { ok: false as const, error };
        return { ok: true as const, spec };
      },
    }),
  };
}
