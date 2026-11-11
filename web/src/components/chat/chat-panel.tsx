"use client";

import { useChat } from "@ai-sdk/react";
import {
  AlertCircle,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Check,
  Filter,
  Grid3x3,
  HelpCircle,
  Loader2,
  MapPin,
  PieChart,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useDrill } from "@/components/drill-context";
import { humanize } from "@/lib/format";
import { ChartCard } from "@/components/charts/chart-card";
import { fallbackSpec, type ChartSpec } from "@/lib/chart-spec";
import type { QueryOutput, QueryResult } from "@/lib/types";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  { icon: TrendingUp, title: "Monthly orders", prompt: "Monthly order count over time" },
  { icon: BarChart3, title: "Top products", prompt: "Top 10 products by number of purchases" },
  { icon: PieChart, title: "Order status mix", prompt: "Order count by status" },
  { icon: MapPin, title: "Distribution centers", prompt: "Where are our distribution centers?" },
  { icon: Filter, title: "Purchase funnel", prompt: "Show the funnel from viewing a product to adding to cart to purchase, by sessions" },
  { icon: Grid3x3, title: "Cohort retention", prompt: "What is the monthly order retention of each signup cohort over the first 12 months?" },
];

type ToolPart = { type: string; state?: string; output?: unknown; errorText?: string };
type ChartOutput = { ok: true; spec: ChartSpec } | { ok: false; error: string };

/** Minimal inline formatting for model text: **bold** only. */
function RichText({ text }: { text: string }) {
  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap">
      {text.split(/(\*\*[^*]+\*\*)/g).map((seg, i) =>
        seg.startsWith("**") && seg.endsWith("**") ? (
          <strong key={i} className="font-semibold">{seg.slice(2, -2)}</strong>
        ) : (
          <Fragment key={i}>{seg}</Fragment>
        ),
      )}
    </p>
  );
}

function Step({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {done ? (
        <span className="flex size-4 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--good)_15%,transparent)] text-[var(--good)]">
          <Check className="size-3" strokeWidth={3} />
        </span>
      ) : (
        <Loader2 className="size-4 animate-spin text-primary" />
      )}
      <span>{children}</span>
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
      <Sparkles className="size-3.5" />
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-6 py-8">
      <div className="space-y-2">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Sparkles className="size-5" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">What would you like to know?</h2>
        <p className="text-sm text-muted-foreground">
          Ask in plain English. I&apos;ll query Snowflake, pick the right chart and point out what stands out.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map(({ icon: Icon, title, prompt }) => (
          <button
            key={title}
            onClick={() => onPick(prompt)}
            className="group flex items-start gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{title}</span>
              <span className="line-clamp-1 block text-xs text-muted-foreground">{prompt}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChatPanel() {
  const { messages, sendMessage, status, error } = useChat();
  const [input, setInput] = useState("");
  const { pending, clear } = useDrill();
  const bottom = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  // Every query result and chart the model has produced, to join charts to rows by queryId.
  const results = new Map<string, QueryResult>();
  const charted = new Set<string>();
  for (const m of messages)
    for (const raw of m.parts) {
      const p = raw as ToolPart;
      if (p.state !== "output-available") continue;
      if (p.type === "tool-querySnowflake") {
        const r = p.output as QueryOutput;
        if (r.kind !== "clarification") results.set(r.queryId, r as QueryResult);
      } else if (p.type === "tool-renderChart" && (p.output as ChartOutput).ok) {
        charted.add((p.output as { spec: ChartSpec }).spec.queryId);
      }
    }

  function submit(text: string, metadata?: unknown) {
    const t = text.trim();
    if (!t || busy) return;
    sendMessage({ text: t, metadata });
    setInput("");
  }

  // A chart (in chat or on the board) asked to drill down: send it as a follow-up.
  useEffect(() => {
    if (!pending || busy) return;
    const { result, filters } = pending;
    const label = filters.map((f) => `${humanize(f.field)} = ${f.value}`).join(", ");
    sendMessage({
      text: `Drill into ${label}`,
      metadata: {
        drill: { queryId: result.queryId, question: result.question, sql: result.sql, filters },
      },
    });
    clear();
  }, [pending, busy, sendMessage, clear]);

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-thin flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {!messages.length ? (
          <EmptyState onPick={(p) => submit(p)} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
                    {m.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex gap-3">
                  <AssistantAvatar />
                  <div className="min-w-0 flex-1 space-y-3 pt-0.5">
                    {m.parts.map((raw, i) => {
                      const p = raw as ToolPart & { text?: string };
                      if (p.type === "text") return p.text ? <RichText key={i} text={p.text} /> : null;

                      if (p.type === "tool-querySnowflake") {
                        if (p.state === "output-error")
                          return (
                            <div key={i} className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                              <AlertCircle className="mt-0.5 size-4 shrink-0" />
                              <span>Query failed: {p.errorText}</span>
                            </div>
                          );
                        if (p.state !== "output-available")
                          return <Step key={i} done={false}>Writing SQL and querying Snowflake…</Step>;
                        const out = p.output as QueryOutput;
                        if (out.kind === "clarification")
                          return (
                            <div key={i} className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
                              <div className="flex items-start gap-2">
                                <HelpCircle className="mt-0.5 size-4 shrink-0 text-primary" />
                                <p className="text-sm">{out.message}</p>
                              </div>
                              <div className="grid gap-1.5">
                                {out.options.map((o) => (
                                  <button
                                    key={o}
                                    disabled={busy}
                                    onClick={() => submit(o)}
                                    className="group flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent/40 disabled:opacity-50"
                                  >
                                    <span>{o}</span>
                                    <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        const r = out;
                        const step = (
                          <Step done>
                            Queried Snowflake · {r.rows.length.toLocaleString()} row{r.rows.length === 1 ? "" : "s"}
                            {r.truncated ? " (truncated)" : ""}
                          </Step>
                        );
                        // Fallback: the model answered without choosing a chart.
                        if (!charted.has(r.queryId) && !busy && r.rows.length)
                          return (
                            <div key={i} className="space-y-3">
                              {step}
                              <ChartCard spec={fallbackSpec(r)} result={r} />
                            </div>
                          );
                        return <Fragment key={i}>{step}</Fragment>;
                      }

                      if (p.type === "tool-renderChart") {
                        if (p.state === "output-error")
                          return <p key={i} className="text-sm text-destructive">Chart failed: {p.errorText}</p>;
                        if (p.state !== "output-available")
                          return (
                            <div key={i} className="space-y-3 rounded-xl border bg-card p-4">
                              <Step done={false}>Building chart…</Step>
                              <Skeleton className="h-56 w-full rounded-lg" />
                            </div>
                          );
                        const out = p.output as ChartOutput;
                        if (!out.ok) return null; // the model sees the error and retries
                        const r = results.get(out.spec.queryId);
                        return r ? <ChartCard key={i} spec={out.spec} result={r} /> : null;
                      }
                      return null;
                    })}
                  </div>
                </div>
              ),
            )}

            {status === "submitted" && (
              <div className="flex gap-3">
                <AssistantAvatar />
                <div className="flex items-center gap-1 pt-2" aria-label="Thinking">
                  {[0, 150, 300].map((d) => (
                    <span
                      key={d}
                      className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
                      style={{ animationDelay: `${d}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{error.message}</span>
              </div>
            )}
            <div ref={bottom} />
          </div>
        )}
      </div>

      <div className="px-4 pb-4 sm:px-6">
        <form
          className={cn(
            "mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm transition-shadow",
            "focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10",
          )}
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
        >
          <Textarea
            suppressHydrationWarning
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            placeholder="Ask about orders, products, users, events…"
            className="max-h-40 min-h-10 resize-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
            rows={1}
          />
          <Button
            type="submit"
            size="icon"
            className="shrink-0 rounded-xl"
            disabled={busy || !input.trim()}
            aria-label="Send"
          >
            {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </form>
        <p className="mx-auto mt-1.5 max-w-3xl px-2 text-[11px] text-muted-foreground">
          Enter to send · Shift+Enter for a new line · Read-only queries, personal data is never returned
        </p>
      </div>
    </div>
  );
}
