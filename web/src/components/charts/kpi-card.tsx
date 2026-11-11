import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatValue, humanize } from "@/lib/format";
import type { ChartSpec } from "@/lib/chart-spec";
import type { QueryResult } from "@/lib/types";

/** Hero number; with two y columns ([current, previous]) it also shows the change. */
export function Kpi({ spec, result }: { spec: ChartSpec; result: QueryResult }) {
  const [curCol, prevCol] = spec.y;
  const row = result.rows[0];
  const current = row?.[curCol];
  const previous = prevCol ? row?.[prevCol] : undefined;

  const delta =
    typeof current === "number" && typeof previous === "number" && previous !== 0
      ? ((current - previous) / Math.abs(previous)) * 100
      : null;
  const up = (delta ?? 0) >= 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="flex min-h-40 flex-col items-start justify-center gap-2 py-4">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{humanize(curCol)}</div>
      <div className="text-5xl font-semibold tracking-tight">{formatValue(current)}</div>
      {delta !== null && (
        <div className="flex items-center gap-2 text-sm">
          <span
            className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium tabular-nums"
            style={{
              color: up ? "var(--good)" : "var(--bad)",
              background: `color-mix(in oklab, ${up ? "var(--good)" : "var(--bad)"} 12%, transparent)`,
            }}
          >
            <Arrow className="size-4" />
            {up ? "+" : "−"}
            {Math.abs(delta).toFixed(1)}%
          </span>
          <span className="text-muted-foreground">vs {formatValue(previous)} previous</span>
        </div>
      )}
    </div>
  );
}
