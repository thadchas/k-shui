<!--
The title of this pull request becomes the commit subject when it is squash-merged,
and this description becomes the commit body. Together they are the ONLY thing
release-please reads to work out the next version and to write CHANGELOG.md.

Title format — https://www.conventionalcommits.org/en/v1.0.0/#summary

    <type>[(optional scope)][!]: <description>

    feat(topics): add per-partition purge with a before-offset cutoff   → MINOR
    fix(kafka): recycle the watermark consumer after failed sweeps      → PATCH
    docs(helm): document values-lakestream.yaml                         → no release
    feat(api)!: require an editor token on the OpenLineage endpoint     → MAJOR (MINOR pre-1.0)

Types: feat, fix, perf, refactor, docs, test, build, ci, chore, style, revert
Scopes: the area you touched — backend, frontend, api, ui, cli, kafka, topics,
messages, consumers, brokers, partitions, schemas, connect, ksql, flink, metrics,
lineage, alerts, auth, rbac, audit, security, docker, helm, chart, kustomize, npm, ci, deps

The `pr-lint` check enforces this, so a red X here is usually a title to reword.
-->

## What & why

<!-- What changes, and what problem it solves. This text ships in the release notes. -->

## How it was verified

<!-- Delete what does not apply. -->

- [ ] `make lint && make test`
- [ ] `helm lint charts/k-shui` / `helm template t charts/k-shui -f charts/k-shui/values-lakestream.yaml`
- [ ] `kubectl kustomize deploy/kustomize/overlays/dev`
- [ ] Tried against a real cluster
- [ ] Docs updated (`docs/`, `README.md`, `docs/deployment/configuration-reference.md`)

## Release impact

- [ ] User-facing behavior changes (make sure the title says `feat` or `fix`)
- [ ] Config/API changes are reflected in `docs/deployment/configuration-reference.md` and `ARCHITECTURE.md`
- [ ] **Breaking change** — the title carries `!` and this description ends with a
      `BREAKING CHANGE:` footer describing what broke and what operators must do

<!--
Breaking changes need a real footer, on its own line, at the very end of this
description, with nothing after it:

BREAKING CHANGE: external OpenLineage producers must now send an editor bearer token.

Other footers work the same way, e.g. `Refs: #42` or `Closes: #42`.
-->
