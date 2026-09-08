# Releasing k-shui

k-shui releases are automated end to end: you write [Conventional
Commits](https://www.conventionalcommits.org/en/v1.0.0/#summary), and
[release-please](https://github.com/googleapis/release-please) turns them into a
[Semantic Version](https://semver.org), a `CHANGELOG.md` entry, a git tag, and
four published artifacts. Nobody edits a version number by hand, and nothing is
published without a human merging a pull request.

> **Nothing has been published yet.** As of this writing the repository has no
> tags and no GitHub releases; `k-shui` is unclaimed on PyPI and on npm; and no
> image or chart has been pushed to GHCR. The workflows below have never run
> against a real registry, so treat every "what you should see" line as the
> intent to verify, not as an observation. [The first
> release](#the-first-release) is the section that changes that.

- [The contract](#the-contract)
- [Writing a pull request](#writing-a-pull-request)
- [What gets released, and when](#what-gets-released-and-when)
- [Cutting a release](#cutting-a-release)
- [Publishing accounts and one-time setup](#publishing-accounts-and-one-time-setup)
- [The first release](#the-first-release)
- [Recovering a partial release](#recovering-a-partial-release)
- [Prereleases, promotion and rollback](#prereleases-promotion-and-rollback)
- [Release evidence checklist](#release-evidence-checklist)
- [The moving parts](#the-moving-parts)
- [Repository settings this depends on](#repository-settings-this-depends-on)
- [Maintainer responsibilities](#maintainer-responsibilities)
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
| Container    | `ghcr.io/thadchas/k-shui`                        | multi-arch, cosign keyless signature, SPDX SBOM     |
| Helm chart   | `oci://ghcr.io/thadchas/charts/k-shui`           | `version` and `appVersion` both track the release   |

Those four names are the canonical namespace. They appear in
`.github/workflows/release.yml`, in `charts/k-shui/values.yaml` (`image.repository`),
in `packages/npm/bin/k-shui.js` (`KSHUI_DOCKER_IMAGE`) and throughout `docs/`;
changing one means changing all of them.

Build metadata (`+build.5`) is rejected by the publishing workflow because Docker
tags cannot contain `+`. Python wheel versions use PEP 440 normalization (for
example, `1.4.0-rc.1` becomes `1.4.0rc1`).

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
   artifacts and appends an install matrix — including a per-artifact status
   line — to the release notes.

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
Actions tab (`workflow_dispatch`) with a tag name. Before it publishes anything
it verifies that every committed version declaration equals the tag, so bump
them first:

```bash
python3 scripts/check_versions.py --set 1.4.0-rc.1
git commit -am "chore(release): v1.4.0-rc.1"
git tag v1.4.0-rc.1 && git push origin main --tags
```

## Publishing accounts and one-time setup

This section is the maintainer's checklist. **Everything in it requires a human
with account access** — none of it can be done from a pull request, and none of
it has been done yet. Work top to bottom; the first release cannot succeed until
the PyPI and npm items are complete.

### PyPI — trusted publishing, no API token

1. Create a [pypi.org](https://pypi.org) account and **enable 2FA** (TOTP or a
   security key). PyPI requires 2FA for anyone who uploads.
2. Create the GitHub environment first, because the trusted publisher has to
   name it: repository **Settings → Environments → New environment**, named
   exactly `pypi`. Optionally add **required reviewers** (the PyPI upload then
   waits for a human click on every release) and limit deployment branches and
   tags to `main` and `v*`. The `pypi` job in `release.yml` declares
   `environment: pypi`, and the environment name is part of the OIDC claim PyPI
   checks — it must match on both sides, character for character.
3. On PyPI, go to **Your account → Publishing → Add a new pending publisher**
   (GitHub) and enter:

   | Field                 | Value         |
   | --------------------- | ------------- |
   | PyPI Project Name     | `k-shui`      |
   | Owner                 | `thadchas`    |
   | Repository name       | `k-shui`      |
   | Workflow name         | `release.yml` |
   | Environment name      | `pypi`        |

   It has to be a **pending** publisher because the project does not exist yet.
   The first successful upload creates the project and converts the pending
   entry into a normal trusted publisher.

4. **Do not create an API token.** Trusted publishing is the whole point; a
   token would be a second, weaker credential to leak.

Renaming `release.yml` invalidates this configuration. If the workflow file ever
moves, update the trusted publisher before the next release.

### npm — token first, trusted publishing second

npm's trusted publishing (OIDC) can only be configured **on a package that
already exists**, and `k-shui` is unclaimed. So the first publish uses a token
and the token goes away afterwards.

1. Create an [npmjs.com](https://www.npmjs.com) account and enable 2FA.
2. Create a **granular access token** (Access Tokens → Generate New Token →
   Granular Access Token): read-and-write on packages, scoped as narrowly as npm
   allows, with the shortest expiry you can live with. Store it as the
   repository secret **`NPM_TOKEN`** (Settings → Secrets and variables →
   Actions → New repository secret). `release.yml` reads it as
   `NODE_AUTH_TOKEN` in the `npm publish` step and nowhere else.
3. Publish the first release (see below). `npm publish --provenance` already
   runs with `id-token: write`, so the tarball is provenance-signed even on the
   token path.
4. **After** the package exists: npm package settings → **Trusted publisher** →
   GitHub Actions, repository `thadchas/k-shui`, workflow `release.yml`. Then
   delete the `NPM_TOKEN` secret and revoke the token itself.
5. Step 4 is a **follow-up that has not been done and is not wired up yet.**
   OIDC publishing needs npm **≥ 11.5**; `actions/setup-node@v4` with Node 22
   ships an npm 10.x, so removing `NPM_TOKEN` also means adding an
   `npm install -g npm@latest` step (or moving to a Node release that bundles a
   new enough npm) to the `npm` job. Do not delete the secret before that change
   lands, or the next release loses its npm artifact.

### GHCR — no account, but two visibility switches

1. Nothing to create and no secret to add: the `docker` and `helm` jobs
   authenticate with the workflow's built-in `GITHUB_TOKEN` and `packages: write`.
2. After the first successful release, two packages appear on the owner's
   **Packages** tab: `k-shui` (the image) and `charts/k-shui` (the chart).
   **Both are private by default.** Open each one → **Package settings** →
   *Danger Zone* → **Change visibility** → Public. Until you do, `docker pull`
   and `helm pull` require credentials, and every anonymous install command in
   `docs/` fails for users.
3. On the same page confirm **Manage Actions access / repository source** points
   at `thadchas/k-shui`, so the package inherits the repository's permissions and
   README. The image carries `org.opencontainers.image.source`, which is what
   makes the linkage automatic; verify rather than assume.
4. To inspect packages from the terminal, the maintainer's `gh` token needs the
   `read:packages` scope: `gh auth refresh -s read:packages`.

### Sigstore keyless signing — nothing to set up

Image signatures are keyless: cosign gets a short-lived certificate from
Fulcio bound to the workflow's GitHub OIDC identity, and the signature is logged
in Rekor. There is no key to generate, store or rotate. The identity consumers
verify against is this repository's `release.yml`, which is why renaming that
file breaks verification of *future* images (already-signed images keep
verifying against the old name).

### `RELEASE_PLEASE_TOKEN` — optional, recommended

GitHub deliberately does not trigger workflows for a pull request opened or
updated by the built-in `GITHUB_TOKEN`. That means a release pull request
authored by `GITHUB_TOKEN` arrives with **no `ci` run and no `pr-lint` run** —
and the release PR is exactly the one that rewrites `version.txt`,
`backend/pyproject.toml`, `backend/k_shui/__init__.py`, `backend/uv.lock`,
`charts/k-shui/Chart.yaml`, both npm manifests, `frontend/package-lock.json`,
`CHANGELOG.md` and `.release-please-manifest.json`.

To get checks on it, create a **fine-grained personal access token** limited to
this repository with **Contents: read and write**, **Pull requests: read and
write**, **Metadata: read**, and store it as the repository secret
`RELEASE_PLEASE_TOKEN`. `release-please.yml` uses
`secrets.RELEASE_PLEASE_TOKEN || secrets.GITHUB_TOKEN`, so the token is optional
and `GITHUB_TOKEN` remains a working fallback — the release still tags and
publishes correctly, its pull request just arrives unchecked. See [the first
release](#the-first-release) for what to verify by hand while the fallback is in
use.

## The first release

The first release is `v0.1.0`, and it is the only one that needs this much
attention.

### How release-please knows it is the first one

`.release-please-manifest.json` is `{}` — deliberately empty. release-please
treats a path with no manifest entry as never released and falls back to
`initial-version` in `release-please-config.json`, which is set to `0.1.0`.

This matters because the manifest used to say `{".": "0.1.0"}`. release-please
reads that as "0.1.0 already shipped", back-fills a phantom `v0.1.0` release,
and therefore proposes **0.2.0** with a changelog that links
`compare/v0.1.0...v0.2.0` — a link to a tag that has never existed. Emptying the
manifest and declaring `initial-version` produces `0.1.0` with no compare link,
because there is no previous tag to compare against.

Two related config settings go with it:

- `group-pull-request-title-pattern` is set to `chore(release): v${version}`.
  With `separate-pull-requests: false`, release-please merges its candidate pull
  requests through the merge plugin, which uses the **group** title pattern —
  the plain `pull-request-title-pattern` is ignored, which is why the first
  attempt produced a PR titled `chore: release main`. That title also fails the
  repo's own conventions; `chore(release): v0.1.0` passes `pr-lint`.
- `pull-request-header` no longer contains `${version}`. release-please does not
  substitute variables in the header, so the literal text `${version}` was being
  rendered into the PR body.

**Consequence for the currently open release PR.** Once this configuration lands
on `main`, the next push to `main` makes release-please rewrite the existing
release pull request in place — same branch (`release-please--branches--main`),
new title (`chore(release): v0.1.0`), new body, and a changelog entry for 0.1.0
instead of 0.2.0. There is nothing to close by hand. If the PR still says
`0.2.0` or is still titled `chore: release main`, the config change has not
reached `main` yet — check the `release-please` job on the latest push.

**One wart to fix in the PR.** `CHANGELOG.md` already contains a hand-written
`## [0.1.0]` section describing the pre-automation work. release-please will
insert its own generated `## 0.1.0 (date)` section above it, so the file will
briefly have two 0.1.0 headings. Merge them by editing `CHANGELOG.md` in the
release pull request before merging — release-please keeps changelog edits made
in the PR.

### Path A — through the release pull request (preferred)

1. Land the release-please configuration on `main` and wait for the
   `release-please` workflow to refresh the pull request.
2. Read the pull request: title `chore(release): v0.1.0`; changelog entry for
   0.1.0 with no compare link; `.release-please-manifest.json` gaining
   `{".": "0.1.0"}`. The version files themselves should show **no diff**,
   because every declaration already says `0.1.0`.
3. **Because the release PR may have no status checks** (see
   `RELEASE_PLEASE_TOKEN` above), before merging:
   - confirm `ci` is green on the `main` commit the release PR is based on, and
   - check out the PR head and run
     `python3 scripts/check_versions.py --expect 0.1.0` locally.

   `release.yml`'s `resolve` job re-checks the same thing after the tag exists,
   so a drifted version fails the release rather than shipping — but it fails
   *after* the tag is created, which is a worse place to find out.
4. **Squash-merge.** release-please creates the tag `v0.1.0` and a GitHub
   release, then calls `release.yml` through `workflow_call`.
5. Watch the `release` run. Expect, in order: `resolve & verify version` →
   `build frontend static assets` → the four publish jobs in parallel →
   `publish GitHub release notes`.

### Path B — a hand-cut tag

Only if you want to publish a commit without a release pull request:

```bash
git checkout main && git pull
python3 scripts/check_versions.py            # every site must already say 0.1.0
git tag v0.1.0 && git push origin v0.1.0
```

The tag push triggers `release.yml` directly. A hand-cut tag does **not** update
`.release-please-manifest.json`, so release-please will still think nothing has
shipped and will propose `0.1.0` again on the next push to `main`; fix that by
merging the release pull request it opens (which writes the manifest) or by
committing the manifest entry yourself.

### What to check at each step

| Job                | What "good" looks like                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `resolve`          | summary line `Publishing v0.1.0 (version 0.1.0, prerelease=false, npm dist-tag=latest)`                     |
| `frontend-build`   | uploads a `static-assets` artifact containing `index.html` and an `assets/` directory                       |
| `pypi`             | the three wheel assertions pass (SPA, `LICENSE`+`NOTICE`, version), then either an upload or a verify line  |
| `npm`              | `npm test` runs the launcher's `--help`, then a publish with `--provenance --access public --tag latest`    |
| `docker`           | a two-platform build, `cosign sign` on the digest, an SPDX SBOM, `actions/attest-sbom` pushing to the registry |
| `helm`             | `helm lint`, a `k-shui-0.1.0.tgz`, and a push to `oci://ghcr.io/thadchas/charts`                             |
| `github-release`   | the release body gains an "Install k-shui 0.1.0" block with four green artifact lines                        |

If the `pypi` job sits in *Waiting*, the `pypi` environment has required
reviewers — approve it.

### Confirming the exact tagged commit shipped

Three independent checks, all of which should name the same commit and version:

```bash
git rev-parse v0.1.0                                   # the reference answer

# 1. the wheel reports the tagged version
uvx --from k-shui==0.1.0 k-shui version                # -> k-shui 0.1.0

# 2. the image records the tagged commit, not a branch head
docker pull ghcr.io/thadchas/k-shui:0.1.0
docker image inspect ghcr.io/thadchas/k-shui:0.1.0 \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}} {{index .Config.Labels "org.opencontainers.image.version"}}'

# 3. the chart tracks the release in both fields
helm show chart oci://ghcr.io/thadchas/charts/k-shui --version 0.1.0 \
  | grep -E '^(version|appVersion):'
```

The image's `revision` label comes from the commit the **tag** points at, not
from `github.sha`: on the `workflow_call` and `workflow_dispatch` paths
`github.sha` is a branch head that can have moved past the tag, so `resolve`
resolves the tag to a SHA and both the `VCS_REF` build argument and the
`org.opencontainers.image.revision` label are set from that.

## Recovering a partial release

The tag exists, some artifacts published, one job went red. Nothing here
requires a new tag.

**Re-run the workflow:** Actions → **release** → *Run workflow* → enter the tag
(for example `v0.1.0`). Every publish job asks the registry what is already
there before it does anything:

| Artifact   | Existence check                                          | If it exists                                                                    | If it does not |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------- |
| PyPI       | `GET https://pypi.org/pypi/k-shui/<pep440>/json`         | verify the wheel filename is listed, report the sha256, **skip the upload**      | build, assert, upload (with `skip-existing`) |
| npm        | `npm view k-shui@<version> version`                      | verify the dist-tag and the provenance attestations, **skip the publish**        | test and publish |
| Image      | `docker buildx imagetools inspect <image>:<version>`      | `cosign verify` the existing digest against this workflow's identity, **skip the build** | build, push, sign, attest |
| Helm chart | `helm pull oci://ghcr.io/thadchas/charts/k-shui --version <v>` | verify the pulled chart's `version` and `appVersion`, **skip the push**      | lint, package, push |

Two things follow from that table:

- **A re-run never overwrites an artifact.** For PyPI and npm that is not a
  policy choice, it is physics: both registries refuse a second upload of the
  same version, and neither lets you replace one. For GHCR and the OCI chart it
  *is* a policy choice — the registry would happily accept a new push to the
  same tag — made so that a recovery run cannot swap out bits somebody has
  already pulled and verified.
- **The GitHub release notes tell the truth.** `github-release` runs with
  `if: !cancelled()` after all four publish jobs, reads each job's result, and
  writes one line per artifact: *published by this run*, *already published;
  verified, not overwritten*, *FAILED*, or *not attempted*. It appends that
  block to whatever body release-please wrote rather than replacing it, and a
  re-run refreshes the block in place instead of stacking a second copy. If any
  artifact job failed, the job then fails on purpose, so the run is red while
  the notes stay accurate.

### If one artifact failed

1. Read the failing job's log and fix the cause — usually a missing credential
   (`NPM_TOKEN`), a not-yet-configured trusted publisher, or a registry 5xx.
2. Re-run `release` with the same tag. The artifacts that already exist are
   verified and left alone; only the missing one is published.
3. Re-check the release notes: the previously-red line should now read
   *published by this run*.

### If something was published *wrong*

There is no repair path. A PyPI version and an npm version can never be
re-uploaded, so a wheel or tarball that shipped broken has to be superseded:
land the fix and cut the next patch version. Do not delete and re-push a tag —
the tag is what the signature identity, the changelog and the release notes all
point at, and a moved tag makes every one of them a lie.

If `resolve & verify version` is the job that failed, nothing was published at
all: the tag disagrees with the committed version declarations. Run
`python3 scripts/check_versions.py --expect <version>` locally to see which file
drifted, fix it on `main`, and cut a new tag — the bad tag published nothing, so
deleting it is safe.

## Prereleases, promotion and rollback

### Prereleases

A tag like `v0.2.0-rc.1` publishes to all four destinations, with these
differences:

- npm gets the dist-tag `next`, so `npx k-shui` keeps resolving to the last
  stable version.
- The image gets **only** the `0.2.0-rc.1` tag — no `latest`, no `0.2`.
- The GitHub release is flagged as a prerelease and is not marked "latest".
- The wheel is normalized to PEP 440: `v0.2.0-rc.1` becomes `0.2.0rc1` on PyPI,
  which is what `pip`/`uv` treat as a pre-release and skip unless asked for.

### Promotion

**There is no promotion operation.** Promoting a release candidate means cutting
a new stable version — a new tag, a new build, new artifacts. It never means
re-tagging or copying the rc's artifacts:

- PyPI and npm versions are immutable; `0.2.0rc1` can never become `0.2.0`.
- Re-pointing the image's `latest` tag at the rc digest would ship a version
  whose wheel and chart do not exist as `0.2.0`.

So: merge the release pull request that release-please opens for `0.2.0`, and
let the normal path run. The rc stays published; users on `next` move to
`latest` on their own schedule.

### Rollback, and its limits

| Destination | What you can do                                                       | What you cannot do                                                    |
| ----------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| PyPI        | **yank** the release (resolvers skip it; a pinned `==` still installs) | reuse the version number — even deleting the release burns it forever |
| npm         | `npm deprecate k-shui@<v> "<reason>"`; unpublish only within 72 hours and only if nothing depends on it | republish a version, ever — an unpublished version is not reusable |
| GHCR image  | delete the version from the Packages UI, or move a floating tag with `docker buildx imagetools create` | un-pull it; anyone who has the digest already has the bits           |
| Helm chart  | delete the chart version from the Packages UI                          | rely on that — clients and caches treat a chart version as immutable  |
| GitHub      | edit or delete the release, mark it not-latest                          | move the git tag without invalidating signatures and changelog links   |

The honest summary: **the only reliable rollback is a new version.** Yank or
deprecate to stop new users from picking up a bad release, then ship the fix as
the next patch.

## Release evidence checklist

The evidence a release actually works is a **clean install from a public
registry on a machine that never built it** — not a green CI run. Run these
after a release and paste the output into the tracking issue for that artifact.
Substitute the released version for `<v>`.

### PyPI wheel

```bash
uv cache clean                                             # no local build to fall back on
uvx --from k-shui==<v> k-shui version                      # -> k-shui <v>
uvx --from k-shui==<v> k-shui serve &                      # binds 127.0.0.1:8090 by default
curl -fsS http://127.0.0.1:8090/healthz                    # -> {"status":"ok",...}
curl -fsS http://127.0.0.1:8090/ | grep -o '<div id="root"' # the SPA, not a JSON 404
```

Then open <http://127.0.0.1:8090/> in a browser and confirm the UI renders — the
`grep` proves `index.html` is served, not that the bundle loads.

### npm launcher

```bash
npx -y k-shui@<v> --help                                   # the launcher's own usage text
npx -y k-shui@<v> version                                  # -> k-shui <v>, via uvx
npm view k-shui@<v> dist.attestations                      # provenance is present
npm view k-shui dist-tags                                  # <v> under latest (or next for an rc)
```

The launcher shells out to `uvx`/`pipx`, so `npx k-shui@<v> version` also proves
the PyPI artifact resolves — run it after the PyPI check, not instead of it.

### Container image

```bash
docker logout ghcr.io                                      # prove it is anonymously pullable
docker pull --platform linux/amd64 ghcr.io/thadchas/k-shui:<v>
docker pull --platform linux/arm64 ghcr.io/thadchas/k-shui:<v>

cosign verify ghcr.io/thadchas/k-shui:<v> \
  --certificate-identity-regexp '^https://github\.com/thadchas/k-shui/\.github/workflows/release\.yml@refs/(heads|tags)/.+$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

gh attestation verify oci://ghcr.io/thadchas/k-shui:<v> --repo thadchas/k-shui

docker run --rm -p 8090:8090 ghcr.io/thadchas/k-shui:<v> &
curl -fsS http://127.0.0.1:8090/healthz
```

The `--certificate-identity-regexp` accepts either ref form because the signing
identity carries `refs/tags/v<v>` for a hand-cut tag and `refs/heads/main` when
release-please calls the workflow. Pin it to the exact ref you expect if you
know which path produced the image.

### Helm chart

```bash
helm pull oci://ghcr.io/thadchas/charts/k-shui --version <v>   # anonymous
helm show chart oci://ghcr.io/thadchas/charts/k-shui --version <v> | grep -E '^(version|appVersion|home|sources):'
helm template k-shui oci://ghcr.io/thadchas/charts/k-shui --version <v> | grep -E 'image: |kind: '

# in a throwaway cluster, not one you care about
kind create cluster --name k-shui-release-check
helm install k-shui oci://ghcr.io/thadchas/charts/k-shui --version <v> --wait --timeout 5m
kubectl port-forward svc/k-shui 8090:8090 &
curl -fsS http://127.0.0.1:8090/healthz
kind delete cluster --name k-shui-release-check
```

`helm template | grep 'image: '` should show `ghcr.io/thadchas/k-shui:<v>` —
the chart's `appVersion` supplies the tag, so this is where an
`appVersion`/release mismatch shows up.

### License and NOTICE coverage

Apache-2.0 obliges every distributed artifact to carry the licence and the
`NOTICE`. In the repository, [`scripts/check_licenses.py`](../../scripts/check_licenses.py)
guards the source copies and the SPDX declarations, `ci` asserts them inside the
built image, and `release.yml`'s `pypi` job asserts them inside the wheel it is
about to upload. What none of those cover is the artifact as a stranger receives
it, so check the published copies once per release:

```bash
# wheel
python3 -m pip download --no-deps --only-binary=:all: "k-shui==<v>" -d /tmp/k-shui-whl
unzip -l /tmp/k-shui-whl/k_shui-*.whl | grep -E 'dist-info/(licenses/)?(LICENSE|NOTICE)'

# npm tarball
npm pack k-shui@<v> --pack-destination /tmp
tar tzf /tmp/k-shui-<v>.tgz | grep -E 'LICENSE|NOTICE'

# chart tarball (from the `helm pull` above, in the current directory)
tar tzf ./k-shui-<v>.tgz | grep LICENSE

# image — `ci` already asserts these on every build; this is the published copy
docker run --rm --entrypoint cat ghcr.io/thadchas/k-shui:<v> \
  /app/LICENSE /app/NOTICE /app/THIRD-PARTY-NOTICES.md > /dev/null && echo ok
```

The npm tarball and the chart tarball are both named `k-shui-<v>.tgz`, so keep
them in different directories.

## The moving parts

| File                                                                                 | Role                                                                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [`release-please-config.json`](../../release-please-config.json)                     | version strategy, `initial-version`, changelog sections, and every file whose version gets bumped |
| [`.release-please-manifest.json`](../../.release-please-manifest.json)               | the last released version — release-please owns this file; `{}` means nothing has shipped |
| [`version.txt`](../../version.txt)                                                   | canonical version marker; everything else is mirrored from it                  |
| [`.github/workflows/release-please.yml`](../../.github/workflows/release-please.yml) | maintains the release PR, tags, and calls the publisher                        |
| [`.github/workflows/release.yml`](../../.github/workflows/release.yml)               | publishes PyPI + npm + GHCR + Helm for one tag, and is re-runnable             |
| [`.github/workflows/pr-lint.yml`](../../.github/workflows/pr-lint.yml)               | enforces the title/description contract and version lock-step                  |
| [`scripts/conventional_commit.py`](../../scripts/conventional_commit.py)             | the validator behind `pr-lint`, the `commit-msg` hook and `make commitlint`    |
| [`scripts/check_versions.py`](../../scripts/check_versions.py)                       | asserts (or applies) one version across all ten declaration sites              |

### Why the tag push does not publish twice

`release.yml` runs on any pushed `v*` tag, and release-please creates the tag —
but GitHub does not re-trigger workflows for refs created with the built-in
`GITHUB_TOKEN`. So the automated path publishes exactly once, through the
`workflow_call` in `release-please.yml`, while a tag you push by hand still
triggers the workflow normally.

If you set `RELEASE_PLEASE_TOKEN`, that reasoning changes: a tag created with a
PAT *does* trigger workflows, so the tag push and the `workflow_call` can both
start a `release` run. The `concurrency` group in `release.yml` is keyed on the
tag with `cancel-in-progress: false`, so the second run queues behind the first
and then finds every artifact already published and verifies it — noisy, but
correct. Watch for it on the first release after adding the token.

### Where the version is declared

`version.txt` is canonical. release-please mirrors it into the application manifests and lockfiles, and
`scripts/check_versions.py` fails CI if any of them drifts:

```
version.txt                  canonical version
backend/pyproject.toml       PyPI wheel / sdist
backend/k_shui/__init__.py   `k-shui version`, /api/v1/info, the OpenAPI doc
packages/npm/package.json    npx launcher
frontend/package.json        SPA build metadata
frontend/package-lock.json   npm root version and locked root package
backend/uv.lock              locked Python project version
charts/k-shui/Chart.yaml     chart version + appVersion
```

The four plain-text files carry an `# x-release-please-version` comment; the npm manifests and lockfile are updated by JSON path. **Adding a new place that
declares the version means adding it to both `SITES` in `check_versions.py` and
`extra-files` in `release-please-config.json`** — a unit test in
[`scripts/tests/test_release_tooling.py`](../../scripts/tests/test_release_tooling.py)
fails if the two lists disagree.

## Repository settings this depends on

- **Squash merge only.** Settings → General → Pull Requests: allow squash
  merging, disable merge commits and rebase merging. Set "Default commit
  message" to **"Pull request title and description"** — that is what makes the
  linted title and description become the commit message.
- **Required checks.** Protect `main` with `pr-lint / conventional commit title &
  description` and the `ci` jobs as required status checks. Note that a release
  pull request authored by `GITHUB_TOKEN` runs neither, so required checks do
  not protect it — see [`RELEASE_PLEASE_TOKEN`](#release_please_token--optional-recommended).
- **Allow GitHub Actions to create and approve pull requests.** Settings →
  Actions → General; without it release-please cannot open the release PR.
- **Environments.** One environment named `pypi`, matching the PyPI trusted
  publisher. Optional required reviewers gate every upload on a human.
- **Secrets.** `NPM_TOKEN` (required until npm trusted publishing is configured)
  and, optionally, `RELEASE_PLEASE_TOKEN`. GHCR, cosign and PyPI use no secret
  at all — `GITHUB_TOKEN` and OIDC cover them.

## Maintainer responsibilities

- Keep 2FA on the PyPI and npm accounts. Both registries can revoke publishing
  rights without it, mid-release.
- Merge the release pull request yourself; it is the only human gate between a
  merged `feat` and a public artifact.
- Remove `NPM_TOKEN` once npm trusted publishing is configured, and rotate it
  before then if it is ever exposed.
- If `release.yml` is renamed or moved, update the PyPI trusted publisher, the
  npm trusted publisher, and the `--certificate-identity-regexp` in
  `docs/deployment/docker.md` and this file — all three name the workflow file.
- Keep the `k-shui` and `charts/k-shui` GHCR packages public. A visibility flip
  breaks every install command in the docs silently, with a 401 that reads like
  a missing tag.
- Never move or reuse a tag, and never try to repair a published version. Ship
  the next patch instead.
- Read the artifact-status block on each release: it is the record of which of
  the four artifacts actually exist for that version.

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
override. For the *first* release specifically, a wrong version almost always
means `.release-please-manifest.json` is not `{}` — see [The first
release](#the-first-release).

**The release PR is titled `chore: release main`.** The
`group-pull-request-title-pattern` config change has not reached `main`. With
`separate-pull-requests: false`, that is the pattern release-please uses;
`pull-request-title-pattern` is ignored.

**The release PR has no checks at all.** Expected with the `GITHUB_TOKEN`
fallback. Verify `ci` on the base commit and run `check_versions.py` on the PR
head by hand, or add `RELEASE_PLEASE_TOKEN`.

**`resolve & verify version` failed in `release.yml`.** The tag disagrees with
the committed version declarations. Run `python3 scripts/check_versions.py
--expect <version>` locally to see which file drifted. Nothing was published;
the tag can be deleted and re-cut.

**A publish job failed after the tag was created.** Fix the cause, then re-run
just that workflow: Actions → `release` → _Run workflow_ → enter the tag. The
already-published artifacts are verified and skipped; only the missing one is
published. See [Recovering a partial release](#recovering-a-partial-release).

**The `pypi` job is stuck in *Waiting*.** The `pypi` environment has required
reviewers. Approve the deployment from the run page.

**`docker pull` returns 401 for an anonymous user.** The GHCR package is still
private. Flip its visibility to Public in the package settings.

**A `chore(release):` PR has a stale changelog.** Push more commits to `main`;
release-please rewrites the open PR on every push. Do not edit its title or
version numbers by hand — edit the changelog prose only.
