"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { ChartSpec, PinnedChart } from "@/lib/chart-spec";
import type { QueryResult } from "@/lib/types";

const KEY = "ai-data-analyst:pinned:v1";

interface Ctx {
  pinned: PinnedChart[];
  isPinned: (queryId: string, title: string) => boolean;
  pin: (spec: ChartSpec, result: QueryResult) => void;
  remove: (id: string) => void;
  resize: (id: string, size: PinnedChart["size"]) => void;
  refresh: (id: string) => Promise<void>;
}

const PinnedContext = createContext<Ctx | null>(null);

export function usePinned() {
  const ctx = useContext(PinnedContext);
  if (!ctx) throw new Error("usePinned must be used inside PinnedProvider");
  return ctx;
}

export function PinnedProvider({ children }: { children: ReactNode }) {
  const [pinned, setPinned] = useState<PinnedChart[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Hydrate after mount (reading in render would mismatch server HTML).
  // localStorage can be unavailable/blocked, so every access is guarded.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setPinned(JSON.parse(raw));
    } catch {}
    setLoaded(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(pinned));
    } catch {
      toast.error("Could not save the board to local storage.");
    }
  }, [pinned, loaded]);

  const isPinned = useCallback(
    (queryId: string, title: string) =>
      pinned.some((p) => p.result.queryId === queryId && p.spec.title === title),
    [pinned],
  );

  const pin = useCallback((spec: ChartSpec, result: QueryResult) => {
    setPinned((prev) => [
      ...prev,
      { id: crypto.randomUUID(), spec, result, size: "md", pinnedAt: Date.now() },
    ]);
    toast.success("Pinned to board");
  }, []);

  const remove = useCallback((id: string) => setPinned((p) => p.filter((c) => c.id !== id)), []);
  const resize = useCallback(
    (id: string, size: PinnedChart["size"]) =>
      setPinned((p) => p.map((c) => (c.id === id ? { ...c, size } : c))),
    [],
  );

  const refresh = useCallback(
    async (id: string) => {
      const target = pinned.find((c) => c.id === id);
      if (!target) return;
      try {
        const res = await fetch("/api/execute", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sql: target.result.sql }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Refresh failed");
        setPinned((p) =>
          p.map((c) =>
            c.id === id
              ? { ...c, result: { ...c.result, rows: body.rows, columns: body.columns, truncated: !!body.truncated, insights: body.insights ?? [] }, refreshedAt: Date.now() }
              : c,
          ),
        );
        toast.success("Chart refreshed");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Refresh failed");
      }
    },
    [pinned],
  );

  return (
    <PinnedContext.Provider value={{ pinned, isPinned, pin, remove, resize, refresh }}>
      {children}
    </PinnedContext.Provider>
  );
}
