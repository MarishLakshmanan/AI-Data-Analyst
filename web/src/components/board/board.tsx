"use client";

import { LayoutDashboard, Maximize2, Minimize2, Pin, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChartCard } from "@/components/charts/chart-card";
import { cn } from "@/lib/utils";
import { usePinned } from "./pinned-provider";

function RefreshButton({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Refresh data"
      title="Refresh data"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await onRefresh();
        setBusy(false);
      }}
    >
      <RefreshCw className={cn(busy && "animate-spin")} />
    </Button>
  );
}

function ago(ts?: number) {
  if (!ts) return null;
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
}

export function Board() {
  const { pinned, remove, resize, refresh } = usePinned();

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/85 px-5 py-3 backdrop-blur">
        <div>
          <h2 className="text-sm font-semibold">Dashboard</h2>
          <p className="text-xs text-muted-foreground">
            {pinned.length ? `${pinned.length} pinned chart${pinned.length === 1 ? "" : "s"}` : "Pin charts from the chat to build your board"}
          </p>
        </div>
      </div>

      {!pinned.length ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/50 px-8 py-10 text-center">
            <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <LayoutDashboard className="size-5" />
            </span>
            <p className="text-sm font-medium">Your dashboard is empty</p>
            <p className="text-xs text-muted-foreground">
              Ask a question, then press <Pin className="inline size-3.5 align-text-bottom" /> on any chart to keep it
              here. Pinned charts can be refreshed with live data at any time.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 p-5 xl:grid-cols-2">
          {pinned.map((p) => {
            const wide = p.size === "lg";
            return (
              <div key={p.id} className={cn("min-w-0", wide && "xl:col-span-2")}>
                <ChartCard
                  spec={p.spec}
                  result={p.result}
                  actions={
                    <>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={wide ? "Half width" : "Full width"}
                        title={wide ? "Half width" : "Full width"}
                        onClick={() => resize(p.id, wide ? "md" : "lg")}
                      >
                        {wide ? <Minimize2 /> : <Maximize2 />}
                      </Button>
                      <RefreshButton onRefresh={() => refresh(p.id)} />
                      <Button size="icon-sm" variant="ghost" aria-label="Remove" title="Remove" onClick={() => remove(p.id)}>
                        <Trash2 />
                      </Button>
                    </>
                  }
                />
                <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
                  {p.refreshedAt ? `Refreshed ${ago(p.refreshedAt)}` : `Pinned ${ago(p.pinnedAt)}`}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
