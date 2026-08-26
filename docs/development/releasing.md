# Releasing k-shui

k-shui releases are automated end to end: you write [Conventional
Commits](https://www.conventionalcommits.org/en/v1.0.0/#summary), and
[release-please](https://github.com/googleapis/release-please) turns them into a
[Semantic Version](https://semver.org), a `CHANGELOG.md` entry, a git tag, and
four published artifacts. Nobody edits a version number by hand, and nothing is
published without a human merging a pull request.

- [The contract](#the-contract)
- [Writing a pull request](#writing-a-pull-request)
- [What gets released, and when](#what-gets-released-and-when)
- [Cutting a release](#cutting-a-release)
- [The moving parts](#the-moving-parts)
- [Bootstrapping the first release](#bootstrapping-the-first-release)
- [Repository settings this depends on](#repository-settings-this-depends-on)
- [Troubleshooting](#troubleshooting)

## The contract

Pull requests are **squash-merged**, so:

| You write                        | It becomes             | It is read by                         |
| -------------------------------- | ---------------------- | ------------------------------------- |
| the pull request **title**       | the commit subject     | release-please → version + changelog  |
| the pull request **description** | the commit body/footer | release-please → changelog + breaking |

That is the whole reason `pr-lint` is strict about the title and description:
they are not paperwork, they are the release input.

```
<type>[(optional scope)][!]: <description>

[optional body]

[optional footer(s)]
```

## Writing a pull request

### Title

| Type                   | Example                                                             | Version bump |
| ---------------------- | ------------------------------------------------------------------- | ------------ |
| `feat`                 | `feat(topics): add per-partition purge with a before-offset cutoff` | **MINOR**    |
| `fix`                  | `fix(kafka): recycle the watermark consumer after failed sweeps`    | **PATCH**    |
| `perf`                 | `perf(messages): stream the tail buffer instead of re-fetching`     | **PATCH**    |
| `revert`               | `revert: feat(topics) per-partition purge`                          | **PATCH**    |
| `refactor`             | `refactor(backend): fold the offset math into one helper`           | **PATCH**    |
| `docs`                 | `docs(helm): document values-lakestream.yaml`                       | **PATCH**    |
| `build`                | `build(docker): drop the build-time npm cache from the final layer` | **PATCH**    |
| `ci`                   | `ci: pin the chart-testing action`                                  | none         |
| `test`                 | `test(kafka): cover the offline-broker deadline`                    | none         |
| `style`                | `style(frontend): re-run prettier`                                  | none         |
| `chore`                | `chore(deps): bump vite to 8.1`                                     | none         |
| any of the above + `!` | `feat(api)!: require an editor token on the OpenLineage endpoint`   | **MAJOR**\*  |

The seven types that appear in `CHANGELOG.md` are exactly the seven that cut a
release; `ci`, `test`, `style` and `chore` are hidden and never release on their
own. A batch of nothing but dependabot bumps produces no release, which is the
intended behavior.

\* While k-shui is pre-1.0, `bump-minor-pre-major` is on, so a breaking change
bumps the **minor** version (`0.4.2` → `0.5.0`) rather than going to `1.0.0`.
Cutting `1.0.0` is a deliberate act — see [Cutting a release](#cutting-a-release).

Scopes are free-form but an unfamiliar one produces a warning, to keep the
changelog readable. The usual ones track the repo: `backend`, `frontend`, `api`,
`ui`, `cli`, `config`, `kafka`, `topics`, `messages`, `consumers`, `brokers`,
`partitions`, `schemas`, `connect`, `ksql`, `flink`, `metrics`, `lineage`,
`alerts`, `auth`, `rbac`, `audit`, `security`, `docker`, `compose`, `helm`,
`chart`, `kustomize`, `npm`, `ci`, `deps`, `release`. The full list lives in
`KNOWN_SCOPES` in [`scripts/conventional_commit.py`](../../scripts/conventional_commit.py).

Style rules `pr-lint` enforces: lower-case type, lower-case scope, exactly one
space after the colon, no trailing period, under 100 characters (it warns past
72). Use the imperative mood — "add", not "added".

### Description

The description is the commit body, so write it for someone reading the release
notes six months from now: what changed and why. `.github/pull_request_template.md`
prompts for the rest. An empty description fails `pr-lint`.

### Breaking changes

A breaking change needs **both** halves:

```
feat(api)!: require an editor token on the OpenLineage endpoint
             ↑ the bang

...description...

BREAKING CHANGE: external OpenLineage producers must now send an editor bearer
token; unauthenticated POSTs to /lineage/openlineage return 401.
```

The `BREAKING CHANGE:` footer goes at the very **end** of the description, after
a blank line, with nothing but other footers below it — that is where the
changelog generator looks. A bang without a footer fails `pr-lint`; a footer
without the bang is accepted and still triggers the bump.

### Checking a message locally

`pre-commit install` wires up a `commit-msg` hook that runs the same validator:

```bash
pre-commit install                      # installs pre-commit *and* commit-msg hooks
make commitlint MSG="feat(topics): add purge"
python3 scripts/conventional_commit.py --header "fix: stop the wedge"
```

## What gets released, and when

Every release publishes the same commit four ways:

| Artifact     | Where                                            | Notes                                               |
| ------------ | ------------------------------------------------ | --------------------------------------------------- |
| Python wheel | [PyPI `k-shui`](https://pypi.org/p/k-shui)       | trusted publishing (OIDC), ships the built SPA      |
| npm launcher | [`k-shui`](https://www.npmjs.com/package/k-shui) | provenance-signed; prereleases go to the `next` tag |
| Container    | `ghcr.io/<owner>/k-shui`                         | multi-arch, cosign keyless signature, SPDX SBOM     |
| Helm chart   | `oci://ghcr.io/<owner>/charts/k-shui`            | `version` and `appVersion` both track the release   |

A prerelease tag (`v1.4.0-rc.1`) publishes everywhere but never moves the
`latest` Docker tag, the `X.Y` Docker tag, or the npm `latest` dist-tag.

## Cutting a release

1. **Merge pull requests to `main` as usual.** On every push to `main`,
   `release-please.yml` recomputes the next version and opens (or updates) a
   single pull request titled `chore(release): vX.Y.Z`.
2. **Review that pull request.** It contains the `CHANGELOG.md` entry and the
   version bump applied to every declaration site. Edit the changelog text in
   the PR if you want to reword it — release-please preserves your edits.
3. **Squash-merge it.** release-please then creates tag `vX.Y.Z` and the GitHub
   release from the changelog, and calls `release.yml`, which publishes all four
   artifacts and appends the install instructions to the release notes.

That is the whole release process. Nothing else is manual.

### Forcing a specific version

To release a version the commits would not produce — the classic case being
`1.0.0` — land a commit with a `Release-As` footer:

```
chore: cut the first stable release

Release-As: 1.0.0
```

release-please picks it up on the next push to `main`.

### Prereleases and hand-cut tags

`release.yml` also runs on any pushed `v*` tag, and can be re-run from the
Actions tab (`workflow_dispatch`) with a tag name — useful when a registry
returned a 503 halfway through. Before it publishes anything it verifies that
every committed version declaration equals the tag, so bump them first:

```bash
python3 scripts/check_versions.py --set 1.4.0-rc.1
git commit -am "chore(release): v1.4.0-rc.1"
git tag v1.4.0-rc.1 && git push origin main --tags
```

## The moving parts

| File                                                                                 | Role                                                                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [`release-please-config.json`](../../release-please-config.json)                     | version strategy, changelog sections, and every file whose version gets bumped |
| [`.release-please-manifest.json`](../../.release-please-manifest.json)               | the last released version — release-please owns this file                      |
| [`version.txt`](../../version.txt)                                                   | canonical version marker; everything else is mirrored from it                  |
| [`.github/workflows/release-please.yml`](../../.github/workflows/release-please.yml) | maintains the release PR, tags, and calls the publisher                        |
| [`.github/workflows/release.yml`](../../.github/workflows/release.yml)               | publishes PyPI + npm + GHCR + Helm for one tag                                 |
| [`.github/workflows/pr-lint.yml`](../../.github/workflows/pr-lint.yml)               | enforces the title/description contract and version lock-step                  |
| [`scripts/conventional_commit.py`](../../scripts/conventional_commit.py)             | the validator behind `pr-lint`, the `commit-msg` hook and `make commitlint`    |
| [`scripts/check_versions.py`](../../scripts/check_versions.py)                       | asserts (or applies) one version across all seven declaration sites            |

### Why the tag push does not publish twice

`release.yml` runs on any pushed `v*` tag, and release-please creates the tag —
but GitHub does not re-trigger workflows for refs created with the built-in
`GITHUB_TOKEN`. So the automated path publishes exactly once, through the
`workflow_call` in `release-please.yml`, while a tag you push by hand still
triggers the workflow normally.

### Where the version is declared

`version.txt` is canonical. release-please mirrors it into six more places, and
`scripts/check_versions.py` fails CI if any of them drifts:

```
version.txt                  canonical version
backend/pyproject.toml       PyPI wheel / sdist
backend/k_shui/__init__.py   `k-shui version`, /api/v1/info, the OpenAPI doc
packages/npm/package.json    npx launcher
frontend/package.json        SPA build metadata
charts/k-shui/Chart.yaml     chart version + appVersion
```

The three plain-text ones carry an `# x-release-please-version` comment; the two
`package.json` files are updated by JSON path. **Adding a new place that
declares the version means adding it to both `SITES` in `check_versions.py` and
`extra-files` in `release-please-config.json`** — a unit test in
[`scripts/tests/test_release_tooling.py`](../../scripts/tests/test_release_tooling.py)
fails if the two lists disagree.

## Bootstrapping the first release

The repository has no tags yet, and `bootstrap-sha` in the config points at
`d3e0e25` (the commit that this automation was built on), so release-please
starts counting from there. `0.1.0` — already declared everywhere and described
in `CHANGELOG.md` — has never actually been published. To publish it:

```bash
git checkout main && git pull
python3 scripts/check_versions.py            # everything says 0.1.0
git tag v0.1.0 && git push origin v0.1.0
```

That runs `release.yml` once by hand. From then on every release comes from a
release pull request, and the next one will be `0.1.1` or `0.2.0` depending on
what has landed.

## Repository settings this depends on

- **Squash merge only.** Settings → General → Pull Requests: allow squash
  merging, disable merge commits and rebase merging. Set "Default commit
  message" to **"Pull request title and description"** — that is what makes the
  linted title and description become the commit message.
- **Required checks.** Protect `main` with `pr-lint / conventional commit title &
description` and the `ci` jobs as required status checks.
- **Allow GitHub Actions to create and approve pull requests.** Settings →
  Actions → General; without it release-please cannot open the release PR.
- **Secrets and environments.** `NPM_TOKEN` (npm publish), a `pypi` environment
  configured as a [PyPI trusted
  publisher](https://docs.pypi.org/trusted-publishers/) for the `release`
  workflow. GHCR uses the built-in `GITHUB_TOKEN`.

## Troubleshooting

**`pr-lint` is red.** Read the job summary — it names the exact rule and shows
the version bump the title would produce. Editing the title re-runs the check.

**No release pull request appeared.** Only `feat`, `fix`, `perf`, `revert` and
breaking changes are releasable. A batch of `chore`/`docs`/`ci` commits
correctly produces nothing; check the `release-please` job summary, which says
so explicitly.

**The release PR proposes the wrong version.** Check the title of each commit
since the last release (`git log --oneline $(git describe --tags --abbrev=0)..`).
A `feat` typo'd as `chore` is the usual cause. Use a `Release-As:` footer to
override.

**`resolve & verify version` failed in `release.yml`.** The tag disagrees with
the committed version declarations. Run `python3 scripts/check_versions.py
--expect <version>` locally to see which file drifted.

**A publish job failed after the tag was created.** Fix the cause, then re-run
just that workflow: Actions → `release` → _Run workflow_ → enter the tag. The
jobs are idempotent apart from registries that reject a re-published version —
in that case bump to the next patch version instead.

**A `chore(release):` PR has a stale changelog.** Push more commits to `main`;
release-please rewrites the open PR on every push. Do not edit its title or
version numbers by hand — edit the changelog prose only.
