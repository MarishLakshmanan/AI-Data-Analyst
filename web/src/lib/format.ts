export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number")
    return Math.abs(v) >= 1000
      ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(v);
}

export function compact(v: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

export function humanize(col: string): string {
  return col.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** ISO date/datetime -> short label; leaves other strings alone. */
export function shortDate(v: unknown): string {
  const s = String(v ?? "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}
