"use client";

import { useState, type ReactNode } from "react";
import {
  ChartArea,
  ChartColumn,
  ChartLine,
  ChartPie,
  ChartScatter,
  Check,
  ChevronRight,
  Copy,
  Filter,
  Grid3x3,
  Hash,
  Lightbulb,
  MapPin,
  Pin,
  PinOff,
  Table2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CHART_TYPES, validateSpec, type ChartSpec, type ChartType } from "@/lib/chart-spec";
import type { QueryResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { usePinned } from "@/components/board/pinned-provider";
import { useDrill } from "@/components/drill-context";
import { ChartRenderer } from "./chart-renderer";
import { DataTable } from "./data-table";
import { FeedbackBar } from "./feedback-bar";

export const CHART_ICONS: Record<ChartType, LucideIcon> = {
  bar: ChartColumn,
  line: ChartLine,
  area: ChartArea,
  pie: ChartPie,
  scatter: ChartScatter,
  heatmap: Grid3x3,
  cohort: Grid3x3,
  map: MapPin,
  funnel: Filter,
  kpi: Hash,
  table: Table2,
};

/** Fill in the encodings a new chart type needs, using sensible defaults from the columns. */
function adapt(spec: ChartSpec, type: ChartType, result: QueryResult): ChartSpec {
  const cols = result.columns;
  const nums = cols.filter((c) => c.type === "number").map((c) => c.name);
  const cats = cols.filter((c) => c.type !== "number").map((c) => c.name);
  const y = spec.y.length ? spec.y : nums.slice(0, 1);
  const lat = nums.find((n) => /lat/i.test(n));
  const lon = nums.find((n) => /lon|lng/i.test(n));
  if (type === "map" && lat && lon) return { ...spec, type, x: lon, y: [lat], series: cats[0] };
  if (type === "scatter") return { ...spec, type, x: nums[0], y: nums.slice(1, 2), series: undefined };
  return {
    ...spec,
    type,
    y: ["heatmap", "cohort", "pie", "funnel", "kpi"].includes(type) ? y.slice(0, 1) : y,
    x: spec.x && !nums.includes(spec.x) ? spec.x : cats[0],
    series: type === "heatmap" || type === "cohort" ? (spec.series ?? cats.find((c) => c !== (spec.x ?? cats[0]))) : spec.series,
  };
}

export function ChartCard({
  spec: initial,
  result,
  actions,
  className,
}: {
  spec: ChartSpec;
  result: QueryResult;
  actions?: ReactNode;
  className?: string;
}) {
  const [spec, setSpec] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const { pin, pinned, remove } = usePinned();
  const { request: requestDrill } = useDrill();
  const pinnedEntry = pinned.find((p) => p.result.queryId === result.queryId && p.spec.title === initial.title);
  const Icon = CHART_ICONS[spec.type] ?? ChartColumn;

  function changeType(type: ChartType) {
    const next = adapt(spec, type, result);
    const err = validateSpec(next, result.columns);
    setError(err);
    if (!err) setSpec(next);
  }

  return (
    <Card className={cn("gap-0 overflow-hidden py-0 shadow-sm", className)}>
      <Tabs defaultValue="chart" className="gap-0">
        {/* Header */}
        <div className="flex items-start gap-3 px-4 pt-4 pb-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-sm leading-snug font-semibold" title={spec.title}>{spec.title}</h3>
            {(spec.description || result.explanation) && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {spec.description ?? result.explanation}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {actions ?? (
              <Button
                size="icon-sm"
                variant="ghost"
                className={cn(pinnedEntry && "text-primary")}
                aria-label={pinnedEntry ? "Unpin from dashboard" : "Pin to dashboard"}
                title={pinnedEntry ? "Unpin from dashboard" : "Pin to dashboard"}
                onClick={() => (pinnedEntry ? remove(pinnedEntry.id) : pin(spec, result))}
              >
                {pinnedEntry ? <PinOff /> : <Pin />}
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-3 px-4">
          {error && <p className="text-xs text-destructive">{error}</p>}
          {result.truncated && (
            <p className="flex items-center gap-1.5 rounded-md bg-[color-mix(in_oklab,var(--chart-4)_12%,transparent)] px-2.5 py-1.5 text-xs">
              <TriangleAlert className="size-3.5 shrink-0 text-[var(--chart-4)]" />
              Showing the first {result.rows.length.toLocaleString()} rows; the full result is larger.
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
          <TabsList className="h-8">
            <TabsTrigger value="chart" className="text-xs">Chart</TabsTrigger>
            <TabsTrigger value="data" className="text-xs">
              Data <span className="text-muted-foreground tabular-nums">{result.rows.length.toLocaleString()}</span>
            </TabsTrigger>
            <TabsTrigger value="sql" className="text-xs">SQL</TabsTrigger>
          </TabsList>
            <Select value={spec.type} onValueChange={(v) => changeType(v as ChartType)}>
              <SelectTrigger size="sm" className="h-8 w-auto min-w-[6.5rem] gap-1.5 text-xs capitalize" aria-label="Chart type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {CHART_TYPES.map((t) => {
                  const I = CHART_ICONS[t];
                  return (
                    <SelectItem key={t} value={t} className="text-xs capitalize">
                      <I className="size-3.5 text-muted-foreground" />
                      {t}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <TabsContent value="chart">
            <ChartRenderer spec={spec} result={result} onSelect={(filters) => requestDrill({ result, filters })} />
          </TabsContent>
          <TabsContent value="data">
            <DataTable result={result} />
          </TabsContent>
          <TabsContent value="sql">
            <SqlBlock sql={result.sql} />
          </TabsContent>

          {result.insights?.length > 0 && (
            <ul className="space-y-1.5 rounded-lg bg-muted/60 p-3">
              {result.insights.slice(0, 4).map((i) => (
                <li key={i.text} className="flex gap-2 text-xs leading-relaxed">
                  <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <span>{i.text}</span>
                </li>
              ))}
            </ul>
          )}
          <Interpretation result={result} />
        </div>

        <div className="mt-3 border-t bg-muted/30 px-4 py-2">
          <FeedbackBar key={result.queryId} result={result} />
        </div>
      </Tabs>
    </Card>
  );
}

function SqlBlock({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="scroll-thin max-h-72 overflow-auto rounded-lg border bg-muted/50 p-3 pr-10 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {sql}
      </pre>
      <Button
        size="icon-sm"
        variant="ghost"
        className="absolute top-1.5 right-1.5"
        aria-label="Copy SQL"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(sql);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {}
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

// Status colour always comes with a text label, never alone.
const CONFIDENCE = {
  high: { label: "High confidence", dot: "bg-[var(--good)]" },
  medium: { label: "Medium confidence", dot: "bg-[var(--chart-4)]" },
  low: { label: "Low confidence", dot: "bg-destructive" },
} as const;

/** "How I answered this": the assumptions behind the SQL, so a wrong reading is easy to spot. */
function Interpretation({ result }: { result: QueryResult }) {
  const assumptions = result.assumptions ?? [];
  const confidence = result.confidence ?? "high";
  if (!assumptions.length && confidence === "high") return null;
  const c = CONFIDENCE[confidence];
  return (
    <details className="group rounded-lg border text-xs" open={confidence === "low"}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
        How I answered this
        <span className="ml-auto flex items-center gap-1.5 font-normal text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", c.dot)} />
          {c.label}
        </span>
      </summary>
      <div className="space-y-2 border-t px-3 py-2.5">
        <ul className="list-disc space-y-1 pl-4 text-muted-foreground marker:text-border">
          {assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        {result.tablesUsed?.length > 0 && (
          <p className="flex flex-wrap gap-1">
            {result.tablesUsed.map((t) => (
              <code key={t} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                {t.split(".").at(-1)}
              </code>
            ))}
          </p>
        )}
        {confidence === "low" && (
          <p className="text-destructive">Not what you meant? Rephrase your question or be more specific.</p>
        )}
      </div>
    </details>
  );
}
