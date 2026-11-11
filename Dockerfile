# Python API (FastAPI + Snowflake). Build context: repo root.
FROM python:3.14-slim AS base

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Dependencies first for layer caching
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
COPY utils ./utils
COPY scripts ./scripts
COPY knowledge_base ./knowledge_base

# Non-root user; /app/data holds the SQLite feedback/board store (mounted as a volume)
RUN useradd --system --uid 1000 --home /app app \
    && mkdir -p /app/data /run/secrets \
    && chown -R app:app /app/data
USER app

# Port the API listens on inside the container (override with API_PORT in compose)
ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ['PORT'], timeout=4).status == 200 else 1)"

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers"]
