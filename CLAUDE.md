# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

An AI data analyst over Snowflake. A Pydantic AI agent turns questions into guardrail-validated, read-only SQL; plain Python executes it and computes insights (`app/`, `utils/`). A Next.js + shadcn + Vercel AI SDK dashboard (`web/`) chats with the user, picks charts as generative UI and keeps a pinned board.

Read the doc for the area you are changing:

- [agent_docs/pipeline.md](agent_docs/pipeline.md): Python backend: SQL agent, guardrail and PII rules, Snowflake execution, insights, API endpoints, feedback store and review, tests and evals.
- [agent_docs/frontend.md](agent_docs/frontend.md): `web/`: chat route and tools, chart spec and chart types, drill-down, state, conventions and gotchas.
- [agent_docs/issues.md](agent_docs/issues.md): open issues. Check it before starting work, and update it when you fix or find one.

Rules that apply everywhere:

- All SQL, including SQL sent back by the client, goes through `validate_sql(..., allowed_tables, pii_columns)`. The agent never executes SQL.
- Never put PII values (columns tagged `pii: true`) in prompts, responses or examples.
- Feedback never changes the agent without human approval in `scripts/review_feedback.py`.

Checks: `uv run pytest` and, in `web/`, `npm test && npx tsc --noEmit && npx eslint src`. Live evals: `uv run python -m evals.run`.
