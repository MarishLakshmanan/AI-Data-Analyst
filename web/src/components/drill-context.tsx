"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { QueryResult } from "@/lib/types";

export type DrillFilter = { field: string; value: string };
export type Drill = { result: QueryResult; filters: DrillFilter[] };

const DrillContext = createContext<{
  pending: Drill | null;
  request: (d: Drill) => void;
  clear: () => void;
} | null>(null);

export function useDrill() {
  const ctx = useContext(DrillContext);
  if (!ctx) throw new Error("useDrill must be used inside DrillProvider");
  return ctx;
}

/** Charts (chat or pinned board) request a drill-down; the chat panel picks it up. */
export function DrillProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Drill | null>(null);
  const request = useCallback((d: Drill) => setPending(d), []);
  const clear = useCallback(() => setPending(null), []);
  return <DrillContext.Provider value={{ pending, request, clear }}>{children}</DrillContext.Provider>;
}
