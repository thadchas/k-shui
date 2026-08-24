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
pip install pre-commit  # or: uv tool install pre-commit
pre-commit install
pre-commit run --all-files
```

## Commit messages & PRs

Use clear, imperative commit messages (`fix: ...`, `feat: ...`, `docs: ...`,
`chore: ...`). CI (`.github/workflows/ci.yml`) runs backend tests across
Python 3.11–3.13, frontend lint/build, `helm lint`, a Docker build, and a
kustomize render on every PR — please make sure it's green before requesting
review.

## Security issues

Do not open a public issue for security vulnerabilities — see `SECURITY.md`.

## Code of conduct

This project follows the `CODE_OF_CONDUCT.md`.
