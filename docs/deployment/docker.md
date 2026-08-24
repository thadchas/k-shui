# Docker

`deploy/docker/Dockerfile` is a 3-stage build:

1. `node:22-alpine` — builds the Vite/React SPA (`frontend/` → `frontend/dist`).
2. `ghcr.io/astral-sh/uv:python3.12-bookworm-slim` — resolves the backend's uv
   environment and copies the built SPA into `k_shui/static/`.
3. `python:3.12-slim` — minimal runtime: the venv from stage 2, running as a
   non-root user (uid/gid `10001`), with a read-only-friendly layout.

`confluent-kafka` ships manylinux wheels that bundle `librdkafka`, so no
`apt-get install librdkafka-dev build-essential` is needed in any stage.

## Build

Build from the **repo root** (the Dockerfile needs both `frontend/` and
`backend/` in its context):

```bash
docker build -f deploy/docker/Dockerfile -t k-shui:local .
# or: make docker
```

Useful build args: `VERSION`, `VCS_REF`, `BUILD_DATE` (populate the OCI labels);
`PYTHON_VERSION` (default `3.12`).

## Run

```bash
docker run --rm -p 8090:8090 \
  -v $PWD/k-shui.yaml:/etc/k-shui/config.yaml \
  k-shui:local
```

k-shui auto-discovers `/etc/k-shui/config.yaml` — mount your config there (or
set `KSHUI_CONFIG=/some/other/path` and mount it accordingly). With nothing
mounted, it falls back to `$KSHUI_BOOTSTRAP_SERVERS` (default `localhost:9092`,
which inside a plain `docker run` won't resolve to a broker — use compose or
`--network host` for genuinely zero-config local testing).

Entrypoint/CMD: `ENTRYPOINT ["k-shui"]`, `CMD ["serve", "--host", "0.0.0.0"]` —
override the CMD to pass different flags, e.g.:

```bash
docker run --rm -p 9000:9000 k-shui:local serve --host 0.0.0.0 --port 9000
```

## Image details

- **User**: non-root, uid/gid `10001`, no login shell.
- **Port**: `8090` (`EXPOSE 8090`).
- **Healthcheck**: a dependency-free `python -c` one-liner hitting `GET /healthz`
  (no `curl`/`wget` needed in the final image).
- **Config volume**: `/etc/k-shui` (`VOLUME ["/etc/k-shui"]`).
- **Labels**: standard OCI `org.opencontainers.image.*` labels (title,
  description, source, licenses, version, revision, created).
- **Env**: `PYTHONUNBUFFERED=1`, `PYTHONDONTWRITEBYTECODE=1`,
  `KSHUI_CONFIG=/etc/k-shui/config.yaml`.

## Environment overrides

Any config field can be overridden with `KSHUI__<SECTION>__<KEY>` (see
`configuration-reference.md`), e.g.:

```bash
docker run --rm -p 8090:8090 \
  -e KSHUI__SERVER__PORT=8090 \
  -e KSHUI_BOOTSTRAP_SERVERS=kafka:9092 \
  k-shui:local
```

## Published images

Releases publish multi-arch (`linux/amd64`, `linux/arm64`) images to
`ghcr.io/<owner>/k-shui`, cosign-signed and with an attached SPDX SBOM
attestation (`.github/workflows/release.yml`). Verify with:

```bash
cosign verify ghcr.io/<owner>/k-shui:<tag> \
  --certificate-identity-regexp '.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## `.dockerignore`

The repo-root `.dockerignore` excludes `.git`, node_modules, Python/venv
caches, existing static build output, and unrelated packaging trees
(`charts/`, `deploy/compose/`, `deploy/kustomize/`, `packages/npm/`, `docs/`)
from the build context to keep builds fast.
