# k-shui (npx launcher)

Run [k-shui](https://github.com/thadchas/k-shui) — open-source, agent-driven
Kafka ecosystem management — without installing Python or Node dependencies
yourself:

```bash
npx k-shui serve --config k-shui.yaml --port 8090
```

This package is a small launcher, not the application itself. It resolves, in order:

1. **`uv`/`uvx` already on PATH** — runs `uvx --from k-shui k-shui <args>`.
2. **`pipx` already on PATH** — runs `pipx run --spec k-shui k-shui <args>`.
3. **Neither found** — asks to download [uv](https://astral.sh/uv) to `~/.k-shui/bin`
   (skip the prompt with `--yes`/`-y`), then re-execs through it.
4. **`--docker`** — skips all of the above and runs the published container instead:
   `docker run --rm -p 8090:8090 -v $PWD/k-shui.yaml:/etc/k-shui/config.yaml ghcr.io/thadchas/k-shui:latest <args>`.

Everything else — `init`, `serve`, `check`, `version`, `--config`, `--port`, ... — is
forwarded verbatim to the real `k-shui` CLI; this wrapper only understands
`--help`/`-h`, `--docker`, and `--yes`/`-y` itself.

## k-shui Agent

k-shui Agent investigates scoped evidence and prepares supported changes; the
k-shui engine enforces the signed-in user's role, executes reviewed actions,
verifies outcomes, and audits mutations. It is disabled by default. Enabling it
requires basic or OIDC authentication plus an administrator-managed AI
provider/model connection, explicit pricing, and a provider key in the server
environment. Start with mutations disabled. See the
[agent guide](https://thadchas.github.io/k-shui-docs/next/k-shui-agent/).

The normal uv/uvx/pipx path inherits environment variables from the `npx`
process. The `--docker` path currently does not forward arbitrary host
environment variables, so use an explicit `docker run --env ...` command or a
Compose/Kubernetes deployment when the agent needs provider secrets. Run a
single k-shui application worker/process while the agent is enabled.

## Examples

```bash
npx k-shui init                              # write a starter k-shui.yaml
npx k-shui serve                              # serve on :8090 with local defaults
npx k-shui --docker serve                     # same, via Docker instead of uv/pipx
npx k-shui --yes serve                        # auto-accept the uv install prompt
```

## Development

```bash
npm test        # node bin/k-shui.js --help
```
