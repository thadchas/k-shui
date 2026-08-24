# Standalone: uv / uvx

The fastest way to run k-shui locally is [uv](https://astral.sh/uv) — no virtualenv
management required.

## Run without installing anything

```bash
uvx k-shui serve --config k-shui.yaml --port 8090
```

`uvx` downloads k-shui into an ephemeral, cached environment and runs it. Repeat
invocations reuse the cache, so subsequent starts are fast.

## Running a pre-release or locally built wheel

Until `k-shui` is published to PyPI, point `--from` at an artifact instead of the
package name — `uvx` resolves the dependencies from PyPI as usual:

```bash
make build                       # frontend into backend/k_shui/static, then the wheel
uvx --from backend/dist/k_shui-0.1.0-py3-none-any.whl k-shui version
uvx --from backend/dist/k_shui-0.1.0-py3-none-any.whl k-shui serve --port 8090
```

The same spec works through the npm launcher via `KSHUI_UVX_FROM` — see
`standalone-npx.md`.

## Install it as a tool

```bash
uv tool install k-shui
k-shui serve --config k-shui.yaml
```

Upgrade with `uv tool upgrade k-shui`; remove with `uv tool uninstall k-shui`.

## From source (contributors)

```bash
git clone https://github.com/thadchas/k-shui.git
cd k-shui
cd frontend && npm ci && npm run build && cd ..   # emits into backend/k_shui/static/
cd backend && uv sync --frozen                     # falls back to `uv sync` if uv.lock is stale
uv run k-shui serve --config ../deploy/examples/k-shui.local.yaml
```

Or simply `make run` / `make dev` from the repo root — see the root `Makefile`.

## CLI

```
k-shui serve   [--config PATH] [--host HOST] [--port PORT]   Start the API + SPA server
k-shui init    [--config PATH]                                Write a starter k-shui.yaml
k-shui check   [--config PATH]                                Validate config, exit non-zero on error
k-shui version                                                 Print the k-shui version
```

### Serving under a sub-path

`server.basePath` (or `KSHUI__SERVER__BASEPATH=/kshui`) mounts the app under a
prefix: `/kshui/`, `/kshui/healthz`, `/kshui/api/v1/...` and `/kshui/assets/...`
all answer. **Caveat for 0.1.0:** the `index.html` that is served still points at
`/assets/...` at the domain root and does not carry the `window.__KSHUI_BASE__`
value the SPA reads, so a reverse proxy that forwards *only* the prefix will fail
to load the bundle. Serve k-shui at `/` (or forward `/assets` and `/api` too)
until that is fixed.

`--config` is optional — k-shui searches, in order: the `--config` flag,
`$KSHUI_CONFIG`, `./k-shui.yaml`, `./k-shui.yml`, `~/.config/k-shui/config.yaml`,
`/etc/k-shui/config.yaml`. With none found, it starts with a single cluster built
from `$KSHUI_BOOTSTRAP_SERVERS` (default `localhost:9092`). See
`configuration-reference.md` for the full schema.

## Systemd (optional)

```ini
# /etc/systemd/system/k-shui.service
[Unit]
Description=k-shui
After=network-online.target

[Service]
Environment=KSHUI_CONFIG=/etc/k-shui/config.yaml
ExecStart=/root/.local/bin/uvx k-shui serve --host 0.0.0.0 --port 8090
Restart=on-failure
User=k-shui
Group=k-shui

[Install]
WantedBy=multi-user.target
```

Adjust the `uvx` path to wherever uv installed it (`uv tool install k-shui` gives a
stable path under `~/.local/bin/k-shui` you can invoke directly instead).
