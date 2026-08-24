# Standalone: npx

If Node is what you have handy, `npx k-shui` works without a local Python install.
The npm package (`packages/npm/`) is a thin launcher — it does not reimplement
k-shui, it runs the real Python CLI for you.

```bash
npx k-shui serve --config k-shui.yaml --port 8090
```

## What it does

In order:

1. If `uv`/`uvx` is on `PATH`, runs `uvx --from k-shui k-shui <args>`.
2. Else if `pipx` is on `PATH`, runs `pipx run --spec k-shui k-shui <args>`.
3. Else, prompts (`[y/N]`) to download [uv](https://astral.sh/uv) into
   `~/.k-shui/bin` and re-execs through it. Skip the prompt with `--yes`/`-y`
   (useful in CI/non-interactive shells, where it otherwise aborts rather than
   silently downloading a binary).
4. `--docker` skips all of the above and instead runs:
   ```bash
   docker run --rm -p 8090:8090 \
     -v $PWD/k-shui.yaml:/etc/k-shui/config.yaml \
     ghcr.io/k-shui/k-shui:latest serve
   ```

Every other argument (`init`, `check`, `version`, `--port`, ...) is forwarded
verbatim to the real `k-shui` CLI.

## Examples

```bash
npx k-shui init                 # write a starter k-shui.yaml in the current directory
npx k-shui serve                # serve on :8090
npx k-shui --yes serve          # non-interactive: auto-install uv if missing
npx k-shui --docker serve       # run via Docker instead
```

## Publishing note (for maintainers)

The package is published from `.github/workflows/release.yml` on `v*` tags with
npm provenance (`npm publish --provenance`). See `packages/npm/README.md` for
local development (`npm test` runs `node bin/k-shui.js --help`).
