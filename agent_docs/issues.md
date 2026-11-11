# Open issues

Known problems and loose ends, most important first. Each item says how we know and what would close it. Remove an item when it is fixed. Last updated 2026-11-10 (after the UI restyle).

## Correctness

1. **Metric definitions are not fixed (revenue, units sold).** The agent sometimes includes and sometimes excludes Cancelled/Returned items. Since the period-over-period examples (which filter `STATUS NOT IN ('Cancelled','Returned')`) were added, `revenue_by_category_top5` fails every eval run, because its reference includes all items. *Close by:* deciding the business definition, adding canonical metric definitions to `metadata_sql.yaml` and the prompt, and aligning the golden references.
2. **The golden eval set is weak and unreviewed.** The 20 result cases were drafted by Claude and are easy (baseline 24/24, ~1.0 requests each); a human has not checked the reference answers. Single runs are noisy (`top_brands_by_units` passed 2 of 3). There are no cases for funnel, cohort, map, insights or drill-down. *Close by:* reviewing each reference, adding harder cases, and a `--repeat N` option that reports pass rates.
3. **Four example queries in the YAML are unreviewed.** Month-over-month orders, latest month vs previous revenue, the product → cart → purchase funnel and cohort retention are marked `verified_by: drafted by Claude`. They run and pass the guardrail, but their logic has not been checked by a person, and they already shape the agent's answers (see 1).
4. **Instruction-following of the small model is unreliable.** Haiku ignored an explicit system-prompt instruction for drill-down (now forced in code). Other prompt-only behaviours may also be skipped: narrating only computed insights, using `kpi` with `[current, previous]` (it charted `PCT_CHANGE` instead), adding reference lines. *Close by:* checking these in evals, or routing the chat loop to a stronger model.
5. **"Never ask twice in a row" is not enforced.** The plan said clarifications would not repeat; the SQL agent is stateless per call, so nothing prevents it.

## Frontend

6. **Live chat flows have not been checked in a browser.** The restyled board was screenshotted (light, dark, mobile) with seeded results for every chart type, but not a real chat session: streaming states, clarification buttons, drill clicks, the feedback bar and the pin flow.
7. **Turbopack's dev cache serves stale code.** The running `next dev` served old modules and old CSS after edits (`feedbackPython is not a function`, then the pre-restyle grey theme). Production builds are correct. *Close by:* stopping `npm run dev`, deleting `web/.next/dev` and restarting; if it recurs, disable the persistent dev cache in `next.config.ts`.
8. **Pinned boards live only in localStorage.** They are per-browser, not shareable, and each stores up to 1000 rows (quota errors show a toast).

## Security and operations

9. **No authentication or rate limiting.** `/api/chat`, `/api/execute`, `/api/feedback` and the FastAPI endpoints are open to anyone who can reach the ports: they can run guardrailed queries on Snowflake, spend LLM credits and write feedback rows. Fine for local use only.
10. **PII coverage is narrow.** Only five columns are tagged. Quasi-identifiers (USERS CITY, POSTAL_CODE, LATITUDE/LONGITUDE, AGE) are selectable, and PII matching is by column name. The rule is also conservative: a CTE that projects a PII column is rejected even if it is only counted later.
11. **`npm audit` reports moderate vulnerabilities** from the scaffolded dependencies; not reviewed.
12. **Nothing is committed.** All work since the initial commit is in the working tree.

## Performance and quality of life

13. **Two LLM hops per question** (chat model → SQL agent), plus a new Snowflake connection for each EXPLAIN and query: roughly 5–30 s per answer, with no progress updates while `/query` runs and no result cache.
14. **Truncated results are charted as-is.** Over 1000 rows, charts show the first 1000 with only a badge; trends and heatmaps may mislead.
15. **Insight heuristics are name-based** (regexes for additive and ID/index columns) and use only the first eligible numeric column.
16. **Noisy Snowflake connector warning** (`enable_server_session_keep_alive_auto_detection`) on every connection.
