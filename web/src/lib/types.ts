export type ColumnType = "number" | "string" | "date" | "boolean";

export type Column = {
  name: string;
  type: ColumnType;
};

export type Row = Record<string, string | number | boolean | null>;

export type Insight = { kind: string; text: string };

export type Confidence = "high" | "medium" | "low";

export type QueryResult = {
  kind: "sql";
  queryId: string;
  question: string;
  sql: string;
  explanation: string;
  tablesUsed: string[];
  assumptions: string[];
  confidence: Confidence;
  /** True when Snowflake had more rows than the API returns. */
  truncated: boolean;
  /** Facts computed in Python (trend, top contributor, outliers...). */
  insights: Insight[];
  columns: Column[];
  rows: Row[];
};

/** The SQL agent asked for clarification (or declined, e.g. for personal data) instead of writing SQL. */
export type ClarificationResult = {
  kind: "clarification";
  queryId: string;
  question: string;
  message: string;
  options: string[];
};

export type QueryOutput = QueryResult | ClarificationResult;
