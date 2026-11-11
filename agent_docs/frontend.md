# Frontend (`web/`)

Next.js 16 (App Router, Turbopack) + shadcn/ui (Tailwind v4, Recharts) + Vercel AI SDK v7. The chart-choosing LLM loop runs here; everything SQL goes through the Python API ([pipeline.md](pipeline.md)).

```
useChat (chat-panel.tsx) → /api/chat (streamText, OpenRouter)
    ├ querySnowflake → lib/python-api.ts → FastAPI POST /query
    └ renderChart    → validateSpec against that result's columns
Pinned refresh → /api/execute → POST /execute      👍/👎 → /api/feedback → POST /feedback
```

## Chat route and tools (`src/app/api/chat/route.ts`, `src/lib/chat-tools.ts`)
- `SYSTEM_PROMPT` holds the workflow and the chart-choice guide; pass it as `instructions` (`system` is deprecated in v7).
- **Rows by reference:** `querySnowflake` returns the full result to the UI, but `toModelOutput` sends the model only columns, row count, 5 sample rows, SQL, assumptions, confidence, truncation and insights. `renderChart` takes a spec with a `queryId`; the UI joins spec and rows. Keep `toModelOutput` small and pass the same `tools` to `convertToModelMessages`.
- `createTools(messages)` rebuilds earlier results from the incoming UI messages, so `refinesQueryId` follow-ups work across turns.
- **Drill-down:** chart clicks send a user message with `metadata.drill {queryId, question, sql, filters}` (works for charts pinned in an earlier session). The route forces step 0 to call `querySnowflake` via `prepareStep` and defaults `refinesQueryId`, because the model would not do it reliably from the prompt alone.
- `stopWhen: stepCountIs(6)`. Clarification outputs: the model relays the message and stops; the UI renders the options as buttons.

## Charts (`src/lib/chart-spec.ts`, `src/components/charts/`)
- `chartSpecSchema` (Zod): `type, title, description?, x?, y[], series?, stacked?, horizontal?, reference?`. `validateSpec` returns a message the model can fix; `fallbackSpec` picks a chart when the model doesn't.
- Types: `bar line area pie scatter` (Recharts via shadcn `chart`), `heatmap` and `cohort` (CSS grid, `heatmap.tsx`, cohort = fixed 0-100% scale), `map` (offline SVG: react-simple-maps + bundled world-atlas; x = longitude, y = [latitude, size?], series = label), `funnel` (CSS, rows in stage order), `kpi` (`y = [current, previous]` adds a % delta), `table`.
- Series keys are sanitised to `k0, k1…` because shadcn turns config keys into CSS variables; labels live in the `ChartConfig`.
- `ChartCard`: Chart / Data / SQL tabs, type switcher (`adapt()` fills encodings), insight chips, "How I answered this" (assumptions + confidence), truncation badge, pin button, `FeedbackBar`.

## Theme and chart styling (`src/app/globals.css`)
- Warm neutral surfaces (page plane darker than card), blue primary, light and dark sets under `:root` / `.dark` (toggled by `theme-toggle.tsx`).
- `--chart-1..5` is a **validated categorical palette** (dataviz skill validator: adjacent CVD ΔE ≥ 8.4, normal-vision ≥ 19.3 in both modes). Keep the slot order; re-run the validator if you change a value. Light slots 3-5 are under 3:1 contrast, so legends and the Data tab must stay.
- `--seq-lo/--seq-hi` (+ `--seq-ink-on-*`) is the one-hue sequential ramp for heatmap/cohort/map; `--ord-hi/--ord-lo` the ordinal ramp for funnel stages; `--chart-grid`, `--chart-axis`, `--chart-ink-muted` are recessive chrome; `--good`/`--bad` are status colours, always paired with an icon or text.
- Marks: 2px lines with ringed dots, 4px rounded bar ends (data end only), 2px surface gaps between slices/stacked segments, ≥8px points. Text never uses a series colour.
- `--font-sans` must point at `--font-geist-sans` (it once referenced itself and silently fell back to a serif).

## Welcome page (`components/welcome.tsx`, `lib/welcome-store.ts`)
`page.tsx` shows a demo disclaimer (demo project; data from the Looker e-commerce BigQuery dataset on Kaggle) before the app. It is shown once per browser **session**: the flag lives in `sessionStorage` (`ai-data-analyst:welcome-seen:v1`); use `localStorage` in `welcomeStore` to show it only once ever. It is read with `useSyncExternalStore` (server snapshot "unknown" renders a blank page, so returning visitors never see a flash), and storage failures fall back to memory. The app and its providers are not mounted until the page is dismissed.

## State
- `components/board/pinned-provider.tsx`: pinned charts in localStorage (guarded with try/catch; hydrated after mount).
- `components/drill-context.tsx`: charts anywhere request a drill; `ChatPanel` sends it. On mobile, a pending drill switches to the Chat tab.
- `page.tsx` renders **one** layout (`useMediaQuery`): resizable split on desktop, tabs on mobile. Rendering both would mount two `useChat` instances.

## Conventions and gotchas
- `cn` comes from `src/lib/utils.ts` (clsx + tailwind-merge). The shadcn CLI once generated `import { cn } from "cn"` (an unrelated npm package): check new components.
- Effects must not return values (an arrow `() => x?.scrollIntoView()` returns its result and crashes React).
- Prompt text lives in a template literal: no unescaped backticks.
- Only one `next dev` may run per directory.
- Turbopack's persistent dev cache (`.next/dev`) can serve **stale** modules and CSS after edits (seen as "x is not a function" and as old theme colours). Fix: stop `next dev`, delete `web/.next/dev`, restart. `npm run build` is not affected.
- Visual check without LLM calls: seed `localStorage["ai-data-analyst:pinned:v1"]` with sample results and screenshot the board (Playwright with the cached Chromium).
- Colors use theme tokens (`--chart-1..5`, `--muted`, …) so light and dark both work.

## Run and test
```
cd web && cp .env.example .env.local   # OPENROUTER_API_KEY, OPENROUTER_MODEL, PY_API_URL
npm install && npm run dev             # :3000 (needs the API on :8000)
npm test                               # vitest: chart spec, drill helpers, feedback route
npx tsc --noEmit && npx eslint src && npm run build
```
