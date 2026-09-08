#!/usr/bin/env python3
"""Keep every k-shui artifact's licensing honest.

k-shui is Apache-2.0. That single fact is written down in a lot of places: the
root LICENSE and NOTICE, the per-artifact copies that make the wheel, the npm
tarball and the Helm chart self-contained, and four SPDX declarations (the
PyPI metadata, package.json, the Artifact Hub chart annotation and the image's
OCI label). Nothing links those copies together at build time, so this script
is the guard that they still agree — the licensing sibling of
`scripts/check_versions.py`.

    python3 scripts/check_licenses.py          # every copy and declaration agrees?
    python3 scripts/check_licenses.py --sync   # re-copy LICENSE/NOTICE into the artifacts

It checks that:

  * the root LICENSE really is the whole Apache-2.0 text (GitHub's licensee
    detector is text-similarity based — a truncated header reads as
    NOASSERTION) and still carries the k-shui copyright line;
  * backend/, packages/npm/ and charts/k-shui/ hold byte-identical copies, so
    each published artifact ships the licence and the NOTICE (Apache-2.0 §4);
  * the packaging manifests actually include those copies (PEP 639
    `license-files`, hatch's sdist `include`, npm's `files`, the Dockerfile
    runtime `COPY` and the `.dockerignore` exclusion it depends on);
  * every SPDX declaration says exactly "Apache-2.0".

Exit code 0 = consistent, 1 = mismatch, 2 = usage error. Stdlib only.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

SPDX = "Apache-2.0"
ROOT_LICENSE = "LICENSE"
ROOT_NOTICE = "NOTICE"
THIRD_PARTY = "THIRD-PARTY-NOTICES.md"

# Phrases that only appear in the complete Apache-2.0 text. A LICENSE holding
# just the short boilerplate header matches none of the later ones, which is
# exactly the failure this catches.
LICENSE_MARKERS: tuple[str, ...] = (
    "                                 Apache License",
    "                           Version 2.0, January 2004",
    "                        http://www.apache.org/licenses/",
    "TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION",
    "1. Definitions.",
    "2. Grant of Copyright License. Subject to the terms and conditions of",
    "3. Grant of Patent License.",
    "4. Redistribution.",
    "5. Submission of Contributions.",
    "6. Trademarks.",
    "7. Disclaimer of Warranty.",
    "8. Limitation of Liability.",
    "9. Accepting Warranty or Additional Liability.",
    "END OF TERMS AND CONDITIONS",
    "APPENDIX: How to apply the Apache License to your work.",
    'Licensed under the Apache License, Version 2.0 (the "License");',
)
# The canonical text is 201 lines; anything much shorter has been truncated.
MIN_LICENSE_LINES = 190
COPYRIGHT_RE = re.compile(r"^\s*Copyright \d{4} k-shui contributors\s*$", re.MULTILINE)


@dataclass(frozen=True)
class Copy:
    """A per-artifact copy that must stay byte-identical to its root original."""

    path: str
    source: str
    what: str


COPIES: tuple[Copy, ...] = (
    Copy("backend/LICENSE", ROOT_LICENSE, "PyPI wheel + sdist"),
    Copy("backend/NOTICE", ROOT_NOTICE, "PyPI wheel + sdist"),
    Copy("packages/npm/LICENSE", ROOT_LICENSE, "npm tarball"),
    Copy("packages/npm/NOTICE", ROOT_NOTICE, "npm tarball"),
    Copy("charts/k-shui/LICENSE", ROOT_LICENSE, "packaged Helm chart"),
)


@dataclass(frozen=True)
class Declaration:
    """One file that names the SPDX licence, and the pattern that finds it."""

    path: str
    pattern: str  # must capture the identifier in group `spdx`
    what: str

    @property
    def regex(self) -> re.Pattern[str]:
        return re.compile(self.pattern, re.MULTILINE)


DECLARATIONS: tuple[Declaration, ...] = (
    Declaration("backend/pyproject.toml", r'^license = "(?P<spdx>[^"]+)"', "PyPI metadata (PEP 639)"),
    Declaration("packages/npm/package.json", r'^  "license": "(?P<spdx>[^"]+)"', "npm package"),
    Declaration(
        "charts/k-shui/Chart.yaml",
        r"^  artifacthub\.io/license: (?P<spdx>[^\s#]+)",
        "Helm chart (Artifact Hub)",
    ),
    Declaration(
        "deploy/docker/Dockerfile",
        r'org\.opencontainers\.image\.licenses="(?P<spdx>[^"]+)"',
        "container image OCI label",
    ),
)


@dataclass(frozen=True)
class Requirement:
    """A packaging manifest line without which an artifact would ship no licence."""

    path: str
    pattern: str
    what: str
    hint: str

    @property
    def regex(self) -> re.Pattern[str]:
        return re.compile(self.pattern, re.MULTILINE)


REQUIREMENTS: tuple[Requirement, ...] = (
    Requirement(
        "backend/pyproject.toml",
        r'^license-files = \["LICENSE", "NOTICE"\]',
        "wheel carries LICENSE + NOTICE in .dist-info/licenses/",
        'add `license-files = ["LICENSE", "NOTICE"]` to [project]',
    ),
    Requirement(
        "backend/pyproject.toml",
        r'^include = \[.*"LICENSE".*"NOTICE".*\]',
        "sdist carries LICENSE + NOTICE",
        'add "LICENSE" and "NOTICE" to [tool.hatch.build.targets.sdist].include',
    ),
    Requirement(
        "packages/npm/package.json",
        r'^    "NOTICE"',
        "npm tarball carries NOTICE (npm auto-includes LICENSE only)",
        'add "NOTICE" to the `files` array',
    ),
    Requirement(
        "deploy/docker/Dockerfile",
        r"^COPY --chown=kshui:kshui LICENSE NOTICE THIRD-PARTY-NOTICES\.md /app/",
        "image carries /app/LICENSE, /app/NOTICE, /app/THIRD-PARTY-NOTICES.md",
        "restore the COPY in the runtime stage",
    ),
    Requirement(
        ".dockerignore",
        r"^!THIRD-PARTY-NOTICES\.md",
        "THIRD-PARTY-NOTICES.md survives the `*.md` exclusion in the build context",
        "keep the `!THIRD-PARTY-NOTICES.md` re-include after `*.md`",
    ),
)

# The pyproject license classifier is deprecated by PEP 639 and a Metadata 2.4
# distribution carrying both it and a License-Expression is rejected on upload.
FORBIDDEN: tuple[Requirement, ...] = (
    Requirement(
        "backend/pyproject.toml",
        r"^\s*\"License :: ",
        "no deprecated license classifier alongside the SPDX expression",
        "delete the `License :: OSI Approved :: ...` classifier",
    ),
)


def read(path: str) -> str:
    """Return the text of a repo-relative path, or exit with a clear error."""
    try:
        return (REPO_ROOT / path).read_text(encoding="utf-8")
    except OSError as exc:
        raise SystemExit(f"error: cannot read {path}: {exc}") from exc


def check_root_license(problems: list[str]) -> None:
    text = read(ROOT_LICENSE)
    missing = [marker for marker in LICENSE_MARKERS if marker not in text]
    lines = len(text.splitlines())
    if missing or lines < MIN_LICENSE_LINES:
        problems.append(
            f"{ROOT_LICENSE} is not the complete Apache-2.0 text "
            f"({lines} lines, {len(missing)} marker(s) missing): "
            + ", ".join(repr(marker.strip()) for marker in missing[:3])
        )
        print(f"  ✗ {ROOT_LICENSE:<28}  truncated or altered Apache-2.0 text")
    else:
        print(f"  ✓ {ROOT_LICENSE:<28}  complete Apache-2.0 text ({lines} lines)")

    if COPYRIGHT_RE.search(text):
        print(f"  ✓ {ROOT_LICENSE:<28}  carries the k-shui copyright line")
    else:
        problems.append(f"{ROOT_LICENSE} has no 'Copyright <year> k-shui contributors' line")
        print(f"  ✗ {ROOT_LICENSE:<28}  missing the k-shui copyright line")

    notice = read(ROOT_NOTICE)
    if COPYRIGHT_RE.search(notice):
        print(f"  ✓ {ROOT_NOTICE:<28}  carries the k-shui copyright line")
    else:
        problems.append(f"{ROOT_NOTICE} has no 'Copyright <year> k-shui contributors' line")
        print(f"  ✗ {ROOT_NOTICE:<28}  missing the k-shui copyright line")

    if THIRD_PARTY in notice:
        print(f"  ✓ {ROOT_NOTICE:<28}  points at {THIRD_PARTY}")
    else:
        problems.append(f"{ROOT_NOTICE} does not point readers at {THIRD_PARTY}")
        print(f"  ✗ {ROOT_NOTICE:<28}  no pointer to {THIRD_PARTY}")

    if (REPO_ROOT / THIRD_PARTY).is_file():
        print(f"  ✓ {THIRD_PARTY:<28}  present")
    else:
        problems.append(f"{THIRD_PARTY} is missing")
        print(f"  ✗ {THIRD_PARTY:<28}  missing")


def check_copies(problems: list[str]) -> None:
    for copy in COPIES:
        original = read(copy.source)
        duplicate = read(copy.path)
        if duplicate == original:
            print(f"  ✓ {copy.path:<28}  identical to {copy.source} ({copy.what})")
        else:
            problems.append(f"{copy.path} differs from {copy.source} — run --sync")
            print(f"  ✗ {copy.path:<28}  differs from {copy.source} ({copy.what})")


def check_declarations(problems: list[str]) -> None:
    for declaration in DECLARATIONS:
        match = declaration.regex.search(read(declaration.path))
        if match is None:
            problems.append(
                f"no SPDX declaration found in {declaration.path} ({declaration.what}); "
                f"expected a line matching /{declaration.pattern}/ — if the file moved, "
                f"update DECLARATIONS in scripts/check_licenses.py"
            )
            print(f"  ✗ {declaration.path:<28}  no licence declaration found")
            continue
        spdx = match.group("spdx").strip()
        if spdx == SPDX:
            print(f"  ✓ {declaration.path:<28}  {spdx:<12} {declaration.what}")
        else:
            problems.append(f"{declaration.path} declares {spdx!r}, expected {SPDX!r} ({declaration.what})")
            print(f"  ✗ {declaration.path:<28}  {spdx:<12} {declaration.what}")


def check_requirements(problems: list[str]) -> None:
    for requirement in REQUIREMENTS:
        if requirement.regex.search(read(requirement.path)):
            print(f"  ✓ {requirement.path:<28}  {requirement.what}")
        else:
            problems.append(f"{requirement.path}: {requirement.what} — {requirement.hint}")
            print(f"  ✗ {requirement.path:<28}  {requirement.what}")
    for forbidden in FORBIDDEN:
        if forbidden.regex.search(read(forbidden.path)):
            problems.append(f"{forbidden.path}: {forbidden.what} — {forbidden.hint}")
            print(f"  ✗ {forbidden.path:<28}  {forbidden.what}")
        else:
            print(f"  ✓ {forbidden.path:<28}  {forbidden.what}")


def check() -> int:
    problems: list[str] = []
    print("license text")
    check_root_license(problems)
    print("\nper-artifact copies")
    check_copies(problems)
    print("\nSPDX declarations")
    check_declarations(problems)
    print("\npackaging manifests")
    check_requirements(problems)

    if problems:
        print(f"\nerror: {len(problems)} licensing problem(s):")
        for problem in problems:
            print(f"       {problem}")
        print(
            "\nThe root LICENSE must stay the verbatim Apache-2.0 text from "
            "https://www.apache.org/licenses/LICENSE-2.0.txt\n"
            "(only the appendix copyright placeholder is filled in). Copies are "
            "refreshed with:  python3 scripts/check_licenses.py --sync"
        )
        return 1

    print(
        f"\nall {len(COPIES)} copies, {len(DECLARATIONS)} SPDX declarations and "
        f"{len(REQUIREMENTS)} packaging manifests agree: {SPDX}"
    )
    return 0


def sync() -> int:
    changed: list[str] = []
    for copy in COPIES:
        original = (REPO_ROOT / copy.source).read_bytes()
        target = REPO_ROOT / copy.path
        if target.is_file() and target.read_bytes() == original:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(original)
        changed.append(f"  {copy.path} ← {copy.source}")
    if changed:
        print(f"refreshed {len(changed)} copy(ies):")
        print("\n".join(changed))
    else:
        print(f"every copy is already identical to {ROOT_LICENSE}/{ROOT_NOTICE}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--sync",
        action="store_true",
        help="re-copy the root LICENSE/NOTICE over every per-artifact copy",
    )
    args = parser.parse_args(argv)

    if args.sync:
        return sync()
    return check()


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
