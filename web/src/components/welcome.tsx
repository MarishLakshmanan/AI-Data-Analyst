"use client";

import { ArrowRight, Database, ExternalLink, FlaskConical } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { welcomeStore, type WelcomeState } from "@/lib/welcome-store";

const DATASET_URL =
  "https://www.kaggle.com/datasets/mustafakeser4/looker-ecommerce-bigquery-dataset?resource=download";

/** "unknown" on the server and during hydration, so the app never flashes before the check. */
export function useWelcome(): WelcomeState | "unknown" {
  return useSyncExternalStore<WelcomeState | "unknown">(
    welcomeStore.subscribe,
    welcomeStore.getSnapshot,
    () => "unknown",
  );
}

export function Welcome({ onContinue }: { onContinue: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[radial-gradient(ellipse_at_top,var(--accent),transparent_60%)] px-4 py-10">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-sm sm:p-8"
      >
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
          <FlaskConical className="size-3.5" /> Demo project
        </span>
        <h1 id="welcome-title" className="mt-4 text-2xl font-semibold tracking-tight">
          Welcome to AI Data Analyst
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask questions in plain English and get SQL, charts and insights back.
        </p>

        <div className="mt-6 space-y-4">
          <div className="flex gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <FlaskConical className="size-4" />
            </span>
            <div className="text-sm">
              <h2 className="font-medium">This is a demo</h2>
              <p className="mt-0.5 text-muted-foreground">
                It&apos;s built to explore AI-generated SQL and generative charts, not for real business decisions.
                Answers are produced by an AI model and can be wrong, so check anything important.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Database className="size-4" />
            </span>
            <div className="text-sm">
              <h2 className="font-medium">About the data</h2>
              <p className="mt-0.5 text-muted-foreground">
                All analysis uses the Looker e-commerce BigQuery dataset, sample data loaded into Snowflake for this
                demo. You can find it on Kaggle:
              </p>
              <a
                href={DATASET_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-block font-medium text-primary underline-offset-4 hover:underline"
              >
                Looker eCommerce BigQuery dataset
                <ExternalLink className="ml-1 inline size-3.5 align-text-bottom" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </div>
          </div>
        </div>

        <Button autoFocus size="lg" className="mt-8 w-full" onClick={onContinue}>
          Continue to the demo
          <ArrowRight />
        </Button>
        <p className="mt-3 text-center text-xs text-muted-foreground">Shown once per browser session.</p>
      </section>
    </main>
  );
}
