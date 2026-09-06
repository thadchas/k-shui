.DEFAULT_GOAL := help
SHELL := /bin/bash

IMAGE ?= k-shui:local
KIND_CLUSTER ?= kind
HELM_RELEASE ?= k-shui
HELM_NAMESPACE ?= k-shui
PORT ?= 8090
COMPOSE_FILE ?= deploy/compose/docker-compose.yml

# Prefer the `docker compose` plugin, fall back to standalone `docker-compose`
# (Colima / older Docker Desktop installs often ship only the latter).
COMPOSE ?= $(shell docker compose version >/dev/null 2>&1 && echo 'docker compose' || echo 'docker-compose')

.PHONY: help dev build build-frontend build-backend run test test-release-tooling lint commitlint version version-check version-set docker compose-up compose-down compose-full-up compose-down-full helm-template helm-lint helm-install kustomize-dev kustomize-prod clean

help: ## Show this help
	@echo "k-shui — available targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

dev: ## Run backend (reload) + frontend dev servers concurrently
	@echo "Backend  -> http://localhost:$(PORT)  (docs at /docs)"
	@echo "Frontend -> http://localhost:5173 (proxies /api to the backend)"
	@( cd backend && uv sync && uv run uvicorn k_shui.main:create_app --factory --reload --port $(PORT) ) & \
	backend_pid=$$!; \
	( cd frontend && npm install && npm run dev ) & \
	frontend_pid=$$!; \
	trap "kill $$backend_pid $$frontend_pid 2>/dev/null" EXIT INT TERM; \
	wait

build: build-frontend build-backend ## Build frontend (into backend static/) then the backend wheel

build-frontend: ## npm ci && npm run build (emits into backend/k_shui/static/)
	cd frontend && npm ci && npm run build

build-backend: ## uv build the backend wheel/sdist
	cd backend && (uv sync --frozen || uv sync) && uv build

run: ## Serve k-shui with the local example config
	cd backend && (uv sync --frozen || uv sync) && uv run k-shui serve --config ../deploy/examples/k-shui.local.yaml --port $(PORT)

test: test-release-tooling ## Run backend, frontend and release-tooling test suites
	cd backend && (uv sync --frozen --dev || uv sync --dev) && uv run pytest
	cd frontend && npm ci && npm run typecheck

test-release-tooling: ## Unit-test scripts/ (stdlib only, no venv needed)
	python3 -m unittest discover -s scripts/tests -t scripts/tests

commitlint: ## Check a commit message: make commitlint MSG="feat(topics): add purge"
	@test -n "$(MSG)" || { echo 'usage: make commitlint MSG="feat(topics): add purge"'; exit 2; }
	@python3 scripts/conventional_commit.py --header "$(MSG)"

version: ## Print the current version
	@python3 scripts/check_versions.py --print

version-check: ## Assert the wheel, npm package, image and chart all declare one version
	@python3 scripts/check_versions.py

version-set: ## Set the version everywhere (release-please normally does this): make version-set VERSION=1.4.0
	@test -n "$(VERSION)" || { echo 'usage: make version-set VERSION=1.4.0'; exit 2; }
	@python3 scripts/check_versions.py --set "$(VERSION)"

lint: ## Lint backend + scripts (ruff) and frontend (eslint)
	cd backend && (uv sync --frozen --dev || uv sync --dev) && uv run ruff check . && uv run ruff format --check .
	uvx ruff check scripts/ && uvx ruff format --check scripts/
	cd frontend && npm ci && npm run lint

docker: ## Build the k-shui Docker image (context = repo root)
	docker build -f deploy/docker/Dockerfile -t $(IMAGE) .

compose-up: ## docker compose up (kafka + k-shui only)
	$(COMPOSE) -f $(COMPOSE_FILE) up --build

compose-full-up: ## docker compose up --profile full (everything: connect, apicurio, flink, prometheus, marquez)
	$(COMPOSE) -f $(COMPOSE_FILE) --profile full up --build

compose-down: ## docker compose down -v
	$(COMPOSE) -f $(COMPOSE_FILE) --profile full down -v

helm-template: ## helm template the chart with default values and values-lakestream.yaml
	helm template t charts/k-shui
	helm template t charts/k-shui -f charts/k-shui/values-lakestream.yaml

helm-lint: ## helm lint the chart
	helm lint charts/k-shui

helm-install: ## helm upgrade --install into $(KIND_CLUSTER) / $(HELM_NAMESPACE)
	helm upgrade --install $(HELM_RELEASE) charts/k-shui \
		--kube-context kind-$(KIND_CLUSTER) \
		--namespace $(HELM_NAMESPACE) --create-namespace

kustomize-dev: ## Render the dev kustomize overlay
	kubectl kustomize deploy/kustomize/overlays/dev

kustomize-prod: ## Render the prod kustomize overlay
	kubectl kustomize deploy/kustomize/overlays/prod

clean: ## Remove build artifacts (frontend dist, backend dist/static, caches)
	rm -rf backend/dist backend/.pytest_cache backend/.ruff_cache backend/.mypy_cache
	rm -rf backend/k_shui/static/* frontend/dist frontend/node_modules/.vite
	find . -name '__pycache__' -not -path '*/node_modules/*' -exec rm -rf {} +
