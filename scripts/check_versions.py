#!/usr/bin/env python3
"""Keep every declared k-shui version in lock-step.

One release ships four artifacts — the PyPI wheel, the npm launcher, the
container image and the Helm chart — and each one carries its own copy of the
version string. release-please bumps them all from `version.txt` (see
release-please-config.json's `extra-files`); this script is the guard that they
really did all move together, so a half-applied bump fails in CI instead of
shipping a wheel that reports the wrong version at `k-shui version`.

    python3 scripts/check_versions.py                 # all sites agree?
    python3 scripts/check_versions.py --expect 1.4.0  # ...and equal 1.4.0 (release gate)
    python3 scripts/check_versions.py --set 1.4.0     # rewrite every site (manual bump)

Exit code 0 = consistent, 1 = mismatch, 2 = usage error. Stdlib only.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Semantic Versioning 2.0.0 — https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
SEMVER_RE = re.compile(
    r"^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)"
    r"(?:-(?P<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)"
    r"(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+(?P<buildmetadata>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
)


@dataclass(frozen=True)
class Site:
    """One file that declares the version, and the pattern that finds it."""

    path: str
    pattern: str  # must capture the version in group `version`
    what: str

    @property
    def regex(self) -> re.Pattern[str]:
        return re.compile(self.pattern, re.MULTILINE)


SITES: tuple[Site, ...] = (
    Site("version.txt", r"\A(?P<version>[^\s]+)\s*\Z", "canonical version (release-please owns this)"),
    Site("backend/pyproject.toml", r'^version = "(?P<version>[^"]+)"', "PyPI wheel / sdist"),
    Site(
        "backend/k_shui/__init__.py",
        r'^__version__ = "(?P<version>[^"]+)"',
        "`k-shui version`, /api/v1/info, OpenAPI",
    ),
    Site("packages/npm/package.json", r'^  "version": "(?P<version>[^"]+)"', "npx launcher"),
    Site("frontend/package.json", r'^  "version": "(?P<version>[^"]+)"', "SPA build metadata"),
    Site("charts/k-shui/Chart.yaml", r"^version: (?P<version>[^\s#]+)", "Helm chart version"),
    Site("charts/k-shui/Chart.yaml", r'^appVersion: "(?P<version>[^"]+)"', "Helm chart appVersion"),
)


def read_site(site: Site) -> tuple[str, str]:
    """Return `(version, text)` for one site, or exit with a clear error."""
    path = REPO_ROOT / site.path
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise SystemExit(f"error: cannot read {site.path}: {exc}") from exc
    match = site.regex.search(text)
    if not match:
        raise SystemExit(
            f"error: no version found in {site.path} ({site.what}).\n"
            f"       expected a line matching /{site.pattern}/ — if the file moved, "
            f"update SITES in scripts/check_versions.py and release-please-config.json"
        )
    return match.group("version").strip(), text


def parse_semver(version: str) -> re.Match[str]:
    match = SEMVER_RE.match(version)
    if not match:
        raise SystemExit(f"error: {version!r} is not a valid Semantic Version (https://semver.org)")
    return match


def check(expect: str | None) -> int:
    found: list[tuple[Site, str]] = [(site, read_site(site)[0]) for site in SITES]
    versions = {version for _, version in found}
    width = max(len(f"{site.path}") for site, _ in found)

    canonical = expect or found[0][1]
    parse_semver(canonical)

    bad = [(site, version) for site, version in found if version != canonical]
    for site, version in found:
        mark = "✓" if version == canonical else "✗"
        print(f"  {mark} {site.path:<{width}}  {version:<16} {site.what}")

    if bad:
        print()
        if expect:
            print(f"error: these files do not declare the expected version {expect}:")
        else:
            print(f"error: version declarations disagree ({', '.join(sorted(versions))}):")
        for site, version in bad:
            print(f"       {site.path} says {version}, expected {canonical}")
        print(
            "\nFix with:  python3 scripts/check_versions.py --set "
            f"{canonical}\n"
            "(normally release-please does this in the release pull request)"
        )
        return 1

    print(f"\nall {len(found)} version declarations agree: {canonical}")
    return 0


def apply(new_version: str) -> int:
    parse_semver(new_version)
    changed: list[str] = []
    for site in SITES:
        current, text = read_site(site)
        if current == new_version:
            continue
        match = site.regex.search(text)
        assert match is not None  # read_site already proved it matches
        start, end = match.span("version")
        (REPO_ROOT / site.path).write_text(text[:start] + new_version + text[end:], encoding="utf-8")
        changed.append(f"  {site.path}: {current} → {new_version}")
    if changed:
        print(f"set version to {new_version} in {len(changed)} declaration(s):")
        print("\n".join(changed))
    else:
        print(f"every version declaration is already {new_version}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--expect", metavar="X.Y.Z", help="also require every site to equal this version")
    group.add_argument(
        "--set", dest="set_version", metavar="X.Y.Z", help="rewrite every site to this version"
    )
    parser.add_argument("--print", action="store_true", help="print the canonical version and exit")
    args = parser.parse_args(argv)

    if args.print:
        print(read_site(SITES[0])[0])
        return 0
    if args.set_version:
        return apply(args.set_version.lstrip("v"))
    return check(args.expect.lstrip("v") if args.expect else None)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
