"use client";

import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { QueryResult } from "@/lib/types";

/** 👍/👎 on an answer. 👍 is sent at once; 👎 asks what was wrong (optional). A human reviews
 *  feedback before it can influence the agent (scripts/review_feedback.py). */
export function FeedbackBar({ result }: { result: QueryResult }) {
  const [state, setState] = useState<"idle" | "commenting" | "sent">("idle");
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");

  async function send(rating: "up" | "down", text?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: result.question,
          sql: result.sql,
          assumptions: result.assumptions ?? [],
          rating,
          comment: text,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not save feedback");
      setState("sent");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save feedback");
    } finally {
      setBusy(false);
    }
  }

  if (state === "sent")
    return (
      <p className="flex h-7 items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="size-3.5" /> Thanks, feedback saved.
      </p>
    );

  if (state === "commenting")
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send("down", comment);
        }}
      >
        <Input
          autoFocus
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="What was wrong? (optional)"
          maxLength={2000}
          className="h-8 text-xs"
        />
        <Button type="submit" size="sm" disabled={busy}>Send</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => send("down")}>
          Skip
        </Button>
      </form>
    );

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="mr-1">Was this right?</span>
      <Button size="icon-sm" variant="ghost" aria-label="Good answer" disabled={busy} onClick={() => send("up")}>
        <ThumbsUp />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Wrong answer" disabled={busy} onClick={() => setState("commenting")}>
        <ThumbsDown />
      </Button>
    </div>
  );
}
