"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Label, Pie, PieChart, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis, ZAxis,
} from "recharts";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { compact, formatValue, humanize, shortDate } from "@/lib/format";
import type { ChartSpec } from "@/lib/chart-spec";
import type { QueryResult } from "@/lib/types";
import type { DrillFilter } from "@/components/drill-context";
import { DataTable } from "./data-table";
import { Funnel } from "./funnel";
import { GeoMap } from "./geo-map";
import { Heatmap } from "./heatmap";
import { Kpi } from "./kpi-card";

const color = (i: number) => `var(--chart-${(i % 5) + 1})`;

type Prepared = { data: Record<string, string | number>[]; keys: string[]; config: ChartConfig };

/** Flatten rows into recharts-friendly data. Keys are sanitised (k0, k1...) because
 *  shadcn turns them into CSS variable names; the real labels live in the config. */
function prepare(spec: ChartSpec, result: QueryResult): Prepared {
  const x = spec.x!;
  const config: ChartConfig = {};

  if (spec.series) {
    const labels: string[] = [];
    const byX = new Map<string, Record<string, string | number>>();
    for (const r of result.rows) {
      const s: string = String(r[spec.series!] ?? "—");
      if (!labels.includes(s)) labels.push(s);
      const xv = shortDate(r[x]);
      const row: Record<string, string | number> = byX.get(xv) ?? { x: xv };
      const k = `k${labels.indexOf(s)}`;
      row[k] = ((row[k] as number) ?? 0) + Number(r[spec.y[0]] ?? 0);
      byX.set(xv, row);
    }
    labels.forEach((l, i) => (config[`k${i}`] = { label: l, color: color(i) }));
    return { data: [...byX.values()], keys: labels.map((_, i) => `k${i}`), config };
  }

  const keys = spec.y.map((_, i) => `k${i}`);
  spec.y.forEach((c, i) => (config[`k${i}`] = { label: humanize(c), color: color(i) }));
  const data = result.rows.map((r) => {
    const row: Record<string, string | number> = { x: shortDate(r[x]) };
    spec.y.forEach((c, i) => (row[`k${i}`] = Number(r[c] ?? 0)));
    return row;
  });
  return { data, keys, config };
}

type Clicked = { payload?: { x?: string; name?: string } };

export function ChartRenderer({
  spec,
  result,
  onSelect,
}: {
  spec: ChartSpec;
  result: QueryResult;
  onSelect?: (filters: DrillFilter[]) => void;
}) {
  // Click a bar / slice -> drill into that category (only categorical x axes make sense).
  const xType = result.columns.find((c) => c.name === spec.x)?.type;
  const select = onSelect && spec.x && xType !== "number"
    ? (label?: string) => label && onSelect([{ field: spec.x!, value: label }])
    : undefined;

  if (spec.type === "table") return <DataTable result={result} />;
  if (spec.type === "kpi") return <Kpi spec={spec} result={result} />;
  if (spec.type === "cohort") return <Heatmap spec={spec} result={result} onSelect={onSelect} percent />;
  if (spec.type === "map") return <GeoMap spec={spec} result={result} />;
  if (spec.type === "funnel") return <Funnel spec={spec} result={result} />;
  if (spec.type === "heatmap") return <Heatmap spec={spec} result={result} onSelect={onSelect} />;
  if (!result.rows.length) return <p className="py-10 text-center text-sm text-muted-foreground">No rows returned.</p>;

  if (spec.type === "pie") {
    const config: ChartConfig = {};
    const data = result.rows.slice(0, 12).map((r, i) => {
      config[`c${i}`] = { label: shortDate(r[spec.x!]), color: color(i) };
      return { key: `c${i}`, name: shortDate(r[spec.x!]), value: Number(r[spec.y[0]] ?? 0), fill: color(i) };
    });
    const total = data.reduce((a, d) => a + d.value, 0);
    return (
      <ChartContainer config={config} className="mx-auto aspect-square max-h-72 w-full">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
          <Pie data={data} dataKey="value" nameKey="key" innerRadius="58%" outerRadius="85%"
            stroke="var(--card)" strokeWidth={2}
            style={select ? { cursor: "pointer" } : undefined}
            onClick={(d: unknown) => select?.((d as { name?: string }).name)}>
            {data.map((d) => <Cell key={d.key} fill={d.fill} />)}
            <Label
              position="center"
              content={({ viewBox }) => {
                const vb = viewBox as { cx?: number; cy?: number } | undefined;
                if (!vb?.cx || !vb?.cy) return null;
                return (
                  <text x={vb.cx} y={vb.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={vb.cx} y={vb.cy - 6} className="fill-foreground text-xl font-semibold">{formatValue(total)}</tspan>
                    <tspan x={vb.cx} y={vb.cy + 14} className="fill-muted-foreground text-[11px]">{humanize(spec.y[0])}</tspan>
                  </text>
                );
              }}
            />
          </Pie>
          <ChartLegend content={<ChartLegendContent nameKey="key" />} className="flex-wrap gap-x-3 gap-y-1" />
        </PieChart>
      </ChartContainer>
    );
  }

  if (spec.type === "scatter") {
    const config: ChartConfig = { k0: { label: humanize(spec.y[0]), color: color(0) } };
    const data = result.rows.map((r) => ({ x: Number(r[spec.x!]), y: Number(r[spec.y[0]]) }));
    return (
      <ChartContainer config={config} className="aspect-video max-h-80 w-full">
        <ScatterChart margin={{ left: 4, right: 12, top: 8 }}>
          <CartesianGrid />
          <ZAxis range={[70, 70]} />
          <XAxis type="number" dataKey="x" name={humanize(spec.x!)} domain={["auto", "auto"]} tickFormatter={compact} />
          <YAxis type="number" dataKey="y" name={humanize(spec.y[0])} domain={["auto", "auto"]} tickFormatter={compact} width={44} />
          <ChartTooltip cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }} content={<ChartTooltipContent hideLabel />} />
          <Scatter data={data} fill="var(--color-k0)" fillOpacity={0.85} stroke="var(--card)" strokeWidth={2} />
        </ScatterChart>
      </ChartContainer>
    );
  }

  const { data, keys, config } = prepare(spec, result);
  const multi = keys.length > 1;
  const common = { data, margin: { left: 4, right: 12, top: 8 } };
  const lastKey = keys[keys.length - 1];
  const xAxis = (
    <XAxis dataKey="x" tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} tickMargin={8} minTickGap={16}
      tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)} />
  );
  const yAxis = <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={compact} />;
  // Hover layer: a muted band behind bars, a crosshair on lines/areas.
  const tooltip =
    spec.type === "bar" ? (
      <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.7 }} content={<ChartTooltipContent />} />
    ) : (
      <ChartTooltip cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }} content={<ChartTooltipContent indicator="line" />} />
    );
  const ref =
    spec.reference && !spec.horizontal ? (
      <ReferenceLine
        y={spec.reference.value}
        stroke="var(--chart-ink-muted)"
        strokeDasharray="4 4"
        label={{ value: spec.reference.label, position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 11 }}
      />
    ) : null;
  const legend = multi ? <ChartLegend content={<ChartLegendContent />} /> : null;

  return (
    <ChartContainer config={config} className="aspect-video max-h-80 w-full">
      {spec.type === "bar" ? (
        <BarChart {...common} layout={spec.horizontal ? "vertical" : "horizontal"} barCategoryGap="22%" barGap={2}>
          <CartesianGrid vertical={!!spec.horizontal} horizontal={!spec.horizontal} />
          {spec.horizontal ? (
            <>
              <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={compact} />
              <YAxis type="category" dataKey="x" tickLine={false} axisLine={false} width={96}
                tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)} />
            </>
          ) : (<>{xAxis}{yAxis}</>)}
          {tooltip}{legend}{ref}
          {keys.map((k) => (
            <Bar key={k} dataKey={k} fill={`var(--color-${k})`} maxBarSize={56}
              // 4px rounding only at the data end (top segment when stacked); the baseline stays square.
              radius={spec.stacked && k !== lastKey ? 0 : spec.horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              stroke={spec.stacked ? "var(--card)" : undefined} strokeWidth={spec.stacked ? 2 : 0}
              stackId={spec.stacked ? "a" : undefined}
              style={select ? { cursor: "pointer" } : undefined}
              onClick={(d: unknown) => select?.((d as Clicked).payload?.x)} />
          ))}
        </BarChart>
      ) : spec.type === "area" ? (
        <AreaChart {...common}>
          <defs>
            {keys.map((k) => (
              <linearGradient key={k} id={`fill-${result.queryId}-${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={`var(--color-${k})`} stopOpacity={0.32} />
                <stop offset="100%" stopColor={`var(--color-${k})`} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} />{xAxis}{yAxis}{tooltip}{legend}{ref}
          {keys.map((k) => (
            <Area key={k} dataKey={k} type="monotone" stroke={`var(--color-${k})`} strokeWidth={2}
              fill={`url(#fill-${result.queryId}-${k})`} stackId={spec.stacked ? "a" : undefined}
              activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }} />
          ))}
        </AreaChart>
      ) : (
        <LineChart {...common}>
          <CartesianGrid vertical={false} />{xAxis}{yAxis}{tooltip}{legend}{ref}
          {keys.map((k) => (
            <Line key={k} dataKey={k} type="monotone" stroke={`var(--color-${k})`}
              strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
              dot={data.length <= 24 ? { r: 3.5, fill: `var(--color-${k})`, stroke: "var(--card)", strokeWidth: 2 } : false}
              activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }} />
          ))}
        </LineChart>
      )}
    </ChartContainer>
  );
}
