import type { Column, Confidence, Insight, QueryOutput, Row } from "./types";

const BASE = process.env.PY_API_URL ?? "http://localhost:8000";

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new Error(`Could not reach the SQL service at ${BASE}. Is FastAPI running?`);
  }
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail).catch(() => res.statusText);
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json() as Promise<T>;
}

export async function queryPython(
  question: string,
  previous?: { question: string; sql: string },
): Promise<QueryOutput> {
  const r = await post<{
    kind: "sql" | "clarification";
    sql: string;
    explanation: string;
    tables_used: string[];
    assumptions: string[];
    confidence: Confidence;
    rows: Row[] | null;
    columns: Column[] | null;
    truncated: boolean;
    insights: Insight[];
    clarification: { question: string; options: string[] } | null;
  }>("/query", { question, run: true, previous });
  const queryId = crypto.randomUUID();
  if (r.kind === "clarification" && r.clarification)
    return {
      kind: "clarification",
      queryId,
      question,
      message: r.clarification.question,
      options: r.clarification.options,
    };
  return {
    kind: "sql",
    queryId,
    question,
    sql: r.sql,
    explanation: r.explanation,
    tablesUsed: r.tables_used,
    assumptions: r.assumptions ?? [],
    confidence: r.confidence ?? "high",
    truncated: r.truncated ?? false,
    insights: r.insights ?? [],
    columns: r.columns ?? [],
    rows: r.rows ?? [],
  };
}

export function executePython(sql: string) {
  return post<{ sql: string; rows: Row[]; columns: Column[]; truncated: boolean; insights: Insight[] }>("/execute", { sql });
}

export function feedbackPython(body: {
  question: string;
  sql: string;
  assumptions: string[];
  rating: "up" | "down";
  comment?: string;
}) {
  return post<{ id: number }>("/feedback", body);
}
