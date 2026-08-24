# k-shui — multi-stage image
#   1. frontend  : node:22-alpine        -> builds the Vite/React SPA
#   2. builder   : uv (python3.12-slim)  -> resolves/builds the venv + wheel, injects static assets
#   3. runtime   : python:3.12-slim      -> minimal non-root runtime
#
# Build from the repo root:
#   docker build -f deploy/docker/Dockerfile -t k-shui:local .

ARG PYTHON_VERSION=3.12

# ---------------------------------------------------------------------------
# Stage 1: frontend build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS frontend

WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
# vite.config.ts writes into ../backend/k_shui/static for local dev; pin the output
# to ./dist here so this stage stays self-contained regardless of that setting.
RUN npm run build -- --outDir dist --emptyOutDir

# ---------------------------------------------------------------------------
# Stage 2: python dependency + build stage (uv)
# ---------------------------------------------------------------------------
FROM ghcr.io/astral-sh/uv:python${PYTHON_VERSION}-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# Install dependencies first (cache-friendly layer); confluent-kafka ships manylinux
# wheels bundling librdkafka, so no apt build-essential/librdkafka-dev needed.
COPY backend/pyproject.toml backend/uv.lock* /app/
RUN if [ -f uv.lock ]; then uv sync --frozen --no-dev --no-install-project; \
    else uv sync --no-dev --no-install-project; fi

# Now bring in the rest of the backend source + the built frontend static assets.
COPY backend/ /app/
COPY --from=frontend /src/frontend/dist/ /app/k_shui/static/

RUN if [ -f uv.lock ]; then uv sync --frozen --no-dev; \
    else uv sync --no-dev; fi

# ---------------------------------------------------------------------------
# Stage 3: runtime
# ---------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim AS runtime

ARG BUILD_DATE
ARG VCS_REF
ARG VERSION=0.1.0

LABEL org.opencontainers.image.title="k-shui" \
      org.opencontainers.image.description="Kafka Streaming Hub UI — open-source Confluent Control Center replacement" \
      org.opencontainers.image.url="https://github.com/k-shui/k-shui" \
      org.opencontainers.image.source="https://github.com/k-shui/k-shui" \
      org.opencontainers.image.documentation="https://github.com/k-shui/k-shui/tree/main/docs" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.vendor="k-shui contributors" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

# Non-root user
RUN groupadd --gid 10001 kshui \
    && useradd --uid 10001 --gid kshui --home-dir /app --shell /usr/sbin/nologin --no-create-home kshui \
    && mkdir -p /app /etc/k-shui \
    && chown -R kshui:kshui /app /etc/k-shui

WORKDIR /app

COPY --from=builder --chown=kshui:kshui /app/.venv /app/.venv
COPY --from=builder --chown=kshui:kshui /app/k_shui /app/k_shui
COPY --from=builder --chown=kshui:kshui /app/pyproject.toml /app/pyproject.toml

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    KSHUI_CONFIG=/etc/k-shui/config.yaml

# App auto-discovers /etc/k-shui/config.yaml when nothing is mounted there it
# falls back to KSHUI_BOOTSTRAP_SERVERS / built-in defaults, so the container
# still starts with zero configuration.
VOLUME ["/etc/k-shui"]

USER kshui:kshui

EXPOSE 8090

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0) if urllib.request.urlopen('http://127.0.0.1:8090/healthz', timeout=2).status == 200 else sys.exit(1)"]

ENTRYPOINT ["k-shui"]
CMD ["serve", "--host", "0.0.0.0"]
