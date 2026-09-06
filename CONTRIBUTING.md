# Contributing to k-shui

Thanks for your interest in k-shui! This repo hosts a Python/FastAPI backend
(`backend/`), a Vite/React frontend (`frontend/`), and packaging/deployment tooling
(`deploy/`, `charts/`, `packages/npm/`, `.github/`). See `ARCHITECTURE.md` for the
full config schema, REST API contract and repo layout every change should respect.

## Getting set up

Prerequisites: [uv](https://astral.sh/uv), Node.js ≥ 22, Docker (for image/compose
work), Helm and `kubectl` (for chart/kustomize work).

```bash
git clone https://github.com/thadchas/k-shui.git
cd k-shui
make dev   # backend (uvicorn --reload) + frontend (vite) side by side
```

Other useful targets — run `make help` for the full list:

```bash
make build           # frontend build -> backend/k_shui/static -> uv build
make run             # serve with deploy/examples/k-shui.local.yaml
make test            # backend pytest + frontend typecheck
make lint            # ruff + eslint
make docker          # build the container image
make compose-up      # kafka + k-shui via docker compose
make compose-full-up # + connect, schema registry, flink, prometheus, marquez
make helm-template   # render the Helm chart
make kustomize-dev   # render the dev kustomize overlay
```

## Making changes

1. Open an issue first for anything non-trivial, so design gets discussed before code.
2. Keep PRs focused — one logical change per PR.
3. Follow the existing code style: `ruff` (backend) and `eslint`/`prettier`
   (frontend) are enforced in CI and via `.pre-commit-config.yaml`.
4. Add or update tests for behavior you change. Backend routers should degrade
   gracefully (`503 problem+json`) when an integration is unconfigured, per
   `ARCHITECTURE.md`'s non-functional requirements — don't let the app crash.
5. Update `docs/` when you change user-facing configuration or deployment
   behavior; `docs/deployment/configuration-reference.md` should stay in sync
   with `backend/k_shui/config.py`.
6. Run the relevant validation before opening a PR:
   ```bash
   make lint && make test
   helm lint charts/k-shui
   helm template t charts/k-shui -f charts/k-shui/values-lakestream.yaml
   kubectl kustomize deploy/kustomize/overlays/dev
   docker compose -f deploy/compose/docker-compose.yml config
   ```

## Pre-commit hooks

```bash
(cd frontend && npm ci)  # the prettier hook runs frontend/node_modules/.bin/prettier
pip install pre-commit  # or: uv tool install pre-commit
pre-commit install
pre-commit run --all-files
```

## Commit messages & pull requests

k-shui releases itself from its commit history, so the message format is part of
the build. Every pull request title **must** be a
[Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/#summary):

```
<type>[(optional scope)][!]: <description>

feat(topics): add per-partition purge with a before-offset cutoff
fix(kafka): recycle the watermark consumer after repeated failed sweeps
docs(helm): document values-lakestream.yaml
feat(api)!: require an editor token on the OpenLineage endpoint
```

Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`,
`chore`, `style`, `revert`. Scope is the area you touched (`kafka`, `frontend`,
`helm`, `auth`, …).

Pull requests are squash-merged, so **the title becomes the commit subject and
the description becomes the commit body** — and those are the only things
[release-please](https://github.com/googleapis/release-please) reads when it
works out the next [semantic version](https://semver.org) and writes
`CHANGELOG.md`. `feat` produces a minor release, `fix`/`perf` a patch, and a `!`
plus a `BREAKING CHANGE:` footer at the end of the description a major one
(minor while we are pre-1.0). Write the description for whoever reads the
release notes later.

The `pr-lint` workflow enforces this on every pull request. To catch it earlier,
`pre-commit install` also installs a `commit-msg` hook that runs the same
validator, and you can check a message directly:

```bash
make commitlint MSG="feat(topics): add per-partition purge"
```

Never hand-edit a version number: `version.txt`, `backend/pyproject.toml`,
`backend/k_shui/__init__.py`, both `package.json` files and
`charts/k-shui/Chart.yaml` are bumped together by the release automation, and
`make version-check` (also a CI job) fails if they ever disagree.

CI (`.github/workflows/ci.yml`) runs backend tests across Python 3.11–3.13,
frontend lint/build, `helm lint`, a Docker build, and a kustomize render on every
pull request — please make sure it's green before requesting review.

**Full release process:** [`docs/development/releasing.md`](docs/development/releasing.md).

## Security issues

Do not open a public issue for security vulnerabilities — see `SECURITY.md`.

## Code of conduct

This project follows the `CODE_OF_CONDUCT.md`.
