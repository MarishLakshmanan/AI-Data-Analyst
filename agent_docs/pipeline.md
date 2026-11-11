# Pipeline (Python backend)

Question → SQL agent → guardrail → Snowflake compile check → execution → insights → API. Python owns everything that touches SQL or Snowflake; the Next.js app ([frontend.md](frontend.md)) only calls the API.

```
POST /query {question, previous?}
  └ app/AI/sql_agent.py   Pydantic AI agent (OpenRouter) writes SQL, never runs it
      └ output validator: utils/sql_guardrail.py  → Snowflake EXPLAIN (utils/snowflake_db.py)
          failure → ModelRetry (max 3)
  └ utils/snowflake_db.py  run_query_limited()  (plain Python, not the agent)
  └ utils/insights.py      deterministic facts from the rows
```

## SQL agent (`app/AI/sql_agent.py`)
- **Model:** OpenRouter, set by `OPENROUTER_MODEL` in `.env`.
- **Context:** the schema prompt (tables, columns, joins, verified example queries) is built at run time from [knowledge_base/metadata_sql.yaml](../knowledge_base/metadata_sql.yaml) by `utils/semantic_model.py`. `load_semantic_model()` also appends queries a human approved from user feedback (see Feedback below).
- **Output union:** `SQLQuery` (`sql`, `explanation`, `tables_used`, `assumptions`, `confidence`) or `Clarification` (`question` + 2-4 `options`). Clarifications are for materially ambiguous questions and for requests for personal data; nothing is executed for them.
- **Follow-ups:** `build_prompt(question, previous)` gives the agent the earlier question and SQL so it edits the query instead of starting over.
- **CLI:** `uv run python -m app.AI.sql_agent "question" [--no-run]`.

## Guardrail (`utils/sql_guardrail.py`) — never bypass it
- sqlglot (Snowflake dialect) parse; exactly one statement; only SELECT/UNION (CTEs allowed); no DML/DDL; only tables from the YAML; schema must be `AI`.
- **PII:** columns tagged `pii: true` in the YAML (USERS EMAIL/FIRST_NAME/LAST_NAME/STREET_ADDRESS, EVENTS IP_ADDRESS) may only appear inside `COUNT(...)`, a `WHERE` or a join `ON`. Selecting, grouping, ordering by them, or `SELECT *` / `t.*` over their tables is rejected. Their sample values are left out of the prompt.
- Every caller passes `pii_columns(model)`: the agent validator, `POST /execute` and the feedback review script.
- **Compile check:** after the guardrail, `explain_query()` runs `EXPLAIN USING TEXT` (no warehouse credits); a `ProgrammingError` (e.g. unknown column) becomes a `ModelRetry`. Connectivity errors skip the check. Disable with `SQL_COMPILE_CHECK=false` (the CLI `--no-run` does this).

## Execution (`utils/snowflake_db.py`)
- `run_query_limited(sql)` returns `(rows, truncated)`, capped at 1000 rows. `run_query()` is the rows-only wrapper.
- Session `STATEMENT_TIMEOUT_IN_SECONDS` = `SNOWFLAKE_STATEMENT_TIMEOUT` (default 60).
- Key-pair auth preferred (`SNOWFLAKE_PRIVATE_KEY_PATH`), password fallback. A new connection is opened per call.

## Insights (`utils/insights.py`)
Plain Python, no LLM: trend / latest change / peak (unique dates only), top and bottom contributor and top-3 share (additive metrics, unique categories only), IQR outliers, null-heavy columns; max 5. ID, index, period and coordinate columns are not treated as metrics (name regexes). The chat model narrates these instead of estimating numbers.

## API (`app/main.py`, FastAPI)
| Endpoint | Purpose |
|---|---|
| `POST /query {question, run?, previous?}` | `kind: "sql"` with `sql, explanation, tables_used, assumptions, confidence, rows, columns, truncated, insights`, or `kind: "clarification"` with `clarification {question, options}`. 422 if the agent gives up, 502 on Snowflake errors. |
| `POST /execute {sql}` | Re-run SQL (pinned-chart refresh). Guardrail first: rejection = 400. |
| `POST /feedback {question, sql, assumptions, rating: up\|down, comment?}` | Store feedback. |
| `GET /health` | Liveness. |

Rows are JSON-safe (`Decimal` → float, dates → ISO strings); `columns` carries `{name, type}` with type `number | string | date | boolean`, inferred from the first non-null value.

## Feedback (`utils/app_db.py`, `scripts/review_feedback.py`)
- SQLite at `data/app.db` (gitignored; override with `APP_DB_PATH`). Tables `feedback` and `verified_queries`.
- **Nothing reaches the agent automatically.** `uv run python -m scripts.review_feedback` shows each 👍 answer: approve / edit / skip. Approval re-runs the guardrail and an `EXPLAIN`, stores the query in `verified_queries` (merged into the prompt by `load_semantic_model()`) and appends a case to `evals/golden.yaml`. `--failures` lists 👎 with comments; `--golden PATH` and `--no-explain` exist for testing.
- Feedback-derived golden cases only guard against regressions: the agent has seen their answer.

## Tests and evals
```
uv run pytest                                  # offline: guardrail, PII, API helpers, insights, comparator, feedback
uv run python -m evals.run [--tag t] [--id x]  # live: OpenRouter + Snowflake
```
- `evals/golden.yaml` cases: `reference_sql` (compared by **result set**, not SQL text: columns matched by value, extra columns tolerated, relative tolerance 1e-3 or 2-decimal rounding), `expect: clarification`, or follow-ups with `previous`.
- Reports go to `evals/reports/` (gitignored). LLM sampling makes single runs noisy: rerun a failing case before trusting it.

## Environment
`.env`: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `SNOWFLAKE_*` (see `.env.example`), optional `SQL_COMPILE_CHECK`, `SNOWFLAKE_STATEMENT_TIMEOUT`, `APP_DB_PATH`.
Run: `uv run uvicorn app.main:app --reload` (port 8000).
