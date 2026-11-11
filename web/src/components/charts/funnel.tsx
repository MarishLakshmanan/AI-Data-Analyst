import { formatValue } from "@/lib/format";
import type { ChartSpec } from "@/lib/chart-spec";
import type { QueryResult } from "@/lib/types";

/** Stages in row order (first = widest), on an ordinal one-hue ramp. Shows each step's
 *  share of the first stage and the conversion from the previous one. */
export function Funnel({ spec, result }: { spec: ChartSpec; result: QueryResult }) {
  const stages = result.rows.map((r) => ({ label: String(r[spec.x!] ?? ""), value: Number(r[spec.y[0]] ?? 0) }));
  const first = stages[0]?.value || 1;
  const widest = Math.max(...stages.map((s) => s.value), 1);
  const n = Math.max(stages.length - 1, 1);

  return (
    <div className="space-y-2 py-1">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const mix = Math.round(100 - (i / n) * 100);
        return (
          <div key={s.label}>
            {prev !== null && (
              <div className="mb-1 pl-1 text-[11px] text-muted-foreground tabular-nums">
                ↓ {((s.value / prev) * 100).toFixed(1)}% continue
              </div>
            )}
            <div className="flex items-end gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="truncate text-xs font-medium" title={s.label}>{s.label}</div>
                <div className="h-6 rounded-md bg-muted/60">
                  <div
                    className="h-full rounded-md"
                    style={{
                      width: `${Math.max((s.value / widest) * 100, 2)}%`,
                      background: `color-mix(in oklab, var(--ord-hi) ${mix}%, var(--ord-lo))`,
                    }}
                    title={`${s.label}: ${formatValue(s.value)}`}
                  />
                </div>
              </div>
              <div className="w-24 shrink-0 text-right">
                <div className="text-sm font-semibold tabular-nums">{formatValue(s.value)}</div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {i === 0 ? "start" : `${((s.value / first) * 100).toFixed(0)}% of start`}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
