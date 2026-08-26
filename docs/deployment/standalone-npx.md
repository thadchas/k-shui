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
     ghcr.io/thadchas/k-shui:latest serve
   ```
   The config bind-mount is added only when `./k-shui.yaml` exists — otherwise
   Docker would create an empty _directory_ at that path. Override the image with
   `KSHUI_DOCKER_IMAGE`.

Every other argument (`init`, `check`, `version`, `--port`, ...) is forwarded
verbatim to the real `k-shui` CLI.

## Installing from somewhere other than PyPI

By default the launcher asks uv/pipx for the published `k-shui` package. Until
that package exists on PyPI — or when you want to try a branch or a locally built
wheel — point it somewhere else with `--from <spec>` or `KSHUI_UVX_FROM=<spec>`.
The spec is passed straight through as `uvx --from <spec>` (`pipx run --spec
<spec>`), so anything uv/pip accepts works: a wheel, an sdist, a project
directory, or a git URL. Relative paths are resolved to absolute paths first.

```bash
# a wheel you just built with `make build`
KSHUI_UVX_FROM=backend/dist/k_shui-0.1.0-py3-none-any.whl npx k-shui version

# same thing as a flag
npx k-shui --from ./backend/dist/k_shui-0.1.0-py3-none-any.whl serve --port 8090

# straight from git (the Python project lives in backend/)
npx k-shui --from 'git+https://github.com/thadchas/k-shui@main#subdirectory=backend' version
```

## Seeing the command without running it

`--dry-run` prints the fully resolved command and exits — handy for debugging
which runner was picked, or what the `--docker` invocation expands to:

```bash
$ npx k-shui --dry-run --from ./backend/dist/k_shui-0.1.0-py3-none-any.whl version
uvx --from /abs/path/backend/dist/k_shui-0.1.0-py3-none-any.whl k-shui version

$ npx k-shui --docker --dry-run serve --port 9000
docker run --rm -i -p 8090:8090 ghcr.io/thadchas/k-shui:latest serve --port 9000
```

`--help` on its own prints the launcher's own help; combine it with `--dry-run`
(`npx k-shui --docker --dry-run --help`) to see the command that would carry the
`--help` through instead.

## Examples

```bash
npx k-shui init                 # write a starter k-shui.yaml in the current directory
npx k-shui serve                # serve on :8090
npx k-shui --yes serve          # non-interactive: auto-install uv if missing
npx k-shui --docker serve       # run via Docker instead
npx k-shui --dry-run serve      # print the command instead of running it
KSHUI_UVX_FROM=./backend/dist/k_shui-0.1.0-py3-none-any.whl npx k-shui version
```

## Launcher flags and environment

| Flag / env                         | Meaning                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `--from <spec>` / `KSHUI_UVX_FROM` | Package spec handed to uvx/uv/pipx instead of `k-shui` (wheel, sdist, directory, git URL) |
| `--docker`                         | Run `ghcr.io/thadchas/k-shui` instead of a Python runner                                  |
| `KSHUI_DOCKER_IMAGE`               | Image used by `--docker`                                                                  |
| `--dry-run`                        | Print the resolved command and exit                                                       |
| `--yes` / `-y`                     | Skip the "install uv?" confirmation                                                       |
| `--help` / `-h`                    | Launcher help (forwarded to the CLI when combined with `--dry-run`)                       |

## Publishing note (for maintainers)

The package is published from `.github/workflows/release.yml` with npm
provenance (`npm publish --provenance`). Releases are cut by merging the
`chore(release): vX.Y.Z` pull request that release-please keeps open — see
[releasing](../development/releasing.md); `packages/npm/package.json` is bumped
there, not by hand. Prereleases publish under the `next` dist-tag, so
`npx k-shui` keeps resolving to the latest stable. See `packages/npm/README.md`
for local development (`npm test` runs `node bin/k-shui.js --help`).
