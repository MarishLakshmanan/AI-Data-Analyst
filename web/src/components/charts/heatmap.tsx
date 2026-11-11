"use client";

import { formatValue, shortDate } from "@/lib/format";
import type { DrillFilter } from "@/components/drill-context";
import type { ChartSpec } from "@/lib/chart-spec";
import type { QueryResult } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Month-start dates (cohorts, monthly buckets) read better as "Feb '23" in narrow axis labels. */
function label(v: unknown): string {
  const s = shortDate(v);
  const m = /^(\d{4})-(\d{2})-01$/.exec(s);
  return m ? `${MONTHS[Number(m[2]) - 1]} '${m[1].slice(2)}` : s;
}

/** Recharts has no heatmap, so this is a CSS grid: x categories x series categories. */
export function Heatmap({
  spec,
  result,
  onSelect,
  percent = false,
}: {
  spec: ChartSpec;
  result: QueryResult;
  onSelect?: (filters: DrillFilter[]) => void;
  /** Values are percentages (cohort retention): fixed 0-100 scale and a % suffix. */
  percent?: boolean;
}) {
  const { x, series, y } = spec;
  if (!x || !series) return null;
  const val = y[0];

  const xs: string[] = [];
  const ss: string[] = [];
  const cell = new Map<string, number>();
  // Display label -> raw value, so drill-down filters use real values (e.g. 2023-02-01, not "Feb '23").
  const raw = new Map<string, string>();
  for (const r of result.rows) {
    const xv = label(r[x]);
    const sv = label(r[series]);
    raw.set(`x:${xv}`, shortDate(r[x]));
    raw.set(`s:${sv}`, shortDate(r[series]));
    if (!xs.includes(xv)) xs.push(xv);
    if (!ss.includes(sv)) ss.push(sv);
    const k = `${sv}\u0000${xv}`;
    cell.set(k, (cell.get(k) ?? 0) + Number(r[val] ?? 0));
  }
  const max = percent ? 100 : Math.max(...cell.values(), 1);
  const show = (n: number) => (percent ? `${formatValue(n)}%` : formatValue(n));

  return (
    <div className="overflow-auto">
      <div
        className="grid gap-[2px] text-xs"
        style={{ gridTemplateColumns: `minmax(4.5rem,auto) repeat(${xs.length}, minmax(${xs.length > 8 ? "2.1rem" : "2.5rem"},1fr))` }}
      >
        <div />
        {xs.map((xv) => (
          <div key={xv} className="truncate px-1 pb-1 text-center text-[11px] text-muted-foreground" title={xv}>
            {xv}
          </div>
        ))}
        {ss.map((sv) => (
          <div key={sv} className="contents">
            <div className="truncate pr-2 text-right text-[11px] leading-8 text-muted-foreground" title={sv}>
              {sv}
            </div>
            {xs.map((xv) => {
              const v = cell.get(`${sv}\u0000${xv}`);
              // One-hue sequential ramp: near-zero recedes toward the surface.
              const t = v === undefined ? 0 : Math.max(0, Math.min(1, v / max));
              const pct = Math.round(6 + t * 94);
              return (
                <div
                  key={xv}
                  title={`${sv} · ${xv}: ${v === undefined ? "no data" : show(v)}`}
                  role={onSelect && v !== undefined ? "button" : undefined}
                  onClick={() => v !== undefined && onSelect?.([{ field: x, value: raw.get(`x:${xv}`) ?? xv }, { field: series, value: raw.get(`s:${sv}`) ?? sv }])}
                  className={`flex h-8 items-center justify-center rounded-[3px] text-[11px] tabular-nums transition-shadow ${onSelect && v !== undefined ? "cursor-pointer hover:ring-2 hover:ring-ring hover:ring-offset-1 hover:ring-offset-card" : ""}`}
                  style={{
                    background:
                      v === undefined
                        ? "repeating-linear-gradient(45deg, var(--muted), var(--muted) 3px, transparent 3px, transparent 6px)"
                        : `color-mix(in oklab, var(--seq-hi) ${pct}%, var(--seq-lo))`,
                    color: pct > 55 ? "var(--seq-ink-on-hi)" : "var(--seq-ink-on-lo)",
                  }}
                >
                  {v !== undefined && xs.length <= 12 ? show(percent ? Math.round(v) : v) : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
        low
        <div
          className="h-2 w-28 rounded-full"
          style={{ background: "linear-gradient(to right, color-mix(in oklab, var(--seq-hi) 6%, var(--seq-lo)), var(--seq-hi))" }}
        />
        high ({show(max)})
      </div>
    </div>
  );
}
