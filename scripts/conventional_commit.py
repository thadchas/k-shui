#!/usr/bin/env python3
"""Validate Conventional Commits (v1.0.0) headers, bodies and footers.

https://www.conventionalcommits.org/en/v1.0.0/#summary

k-shui squash-merges every pull request, so the PR **title** becomes the commit
subject and the PR **description** becomes the commit body. That squashed
message is the only thing release-please ever reads to decide the next semantic
version and to write CHANGELOG.md — which is why the same rules are enforced in
three places from this one module:

* ``--pr-title``/``--pr-body``  → .github/workflows/pr-lint.yml (pull requests)
* ``--commit-msg-file``        → the ``conventional-commit`` pre-commit hook
* ``--header``                 → ad-hoc/manual checks (``make commitlint``)

Exit code 0 = valid (warnings may still be printed), 1 = invalid, 2 = usage
error. Stdlib only: it runs under bare ``python3`` in CI, hooks and locally.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass, field

# Types that may appear in a header. `feat` and `fix` are mandated by the spec;
# the rest are the Angular convention plus what this repo actually ships.
# Keep in sync with `changelog-sections` in release-please-config.json.
TYPES: dict[str, str] = {
    "feat": "a new user-facing capability (bumps the MINOR version)",
    "fix": "a bug fix (bumps the PATCH version)",
    "perf": "a change that improves performance (PATCH)",
    "refactor": "a code change that neither fixes a bug nor adds a feature",
    "docs": "documentation only",
    "test": "adding or correcting tests",
    "build": "build system, packaging, dependencies (wheel, npm, Docker, Helm)",
    "ci": "CI configuration and workflows",
    "chore": "housekeeping that does not belong to any other type",
    "style": "formatting only, no behavior change",
    "revert": "reverts a previous commit",
}

# Types that appear in CHANGELOG.md, and therefore cut a release. `feat` makes it
# a MINOR bump, the rest a PATCH; a `!`/`BREAKING CHANGE:` overrides both. Types
# outside this set (ci, test, style, chore) are hidden and never release on their
# own. Mirrors the non-hidden `changelog-sections` in release-please-config.json —
# scripts/tests/test_release_tooling.py fails if the two drift apart.
RELEASING_TYPES: frozenset[str] = frozenset({"feat", "fix", "perf", "revert", "refactor", "docs", "build"})

# Advisory only — an unknown scope warns, it never fails. Keeps CHANGELOG
# scopes consistent without blocking a contributor on a name we did not predict.
KNOWN_SCOPES: frozenset[str] = frozenset(
    {
        # surfaces
        "backend",
        "frontend",
        "api",
        "ui",
        "cli",
        "config",
        "docs",
        "readme",
        "site",
        # kafka + integrations
        "kafka",
        "topics",
        "messages",
        "consumers",
        "brokers",
        "partitions",
        "schemas",
        "connect",
        "ksql",
        "flink",
        "metrics",
        "lineage",
        "alerts",
        "replication",
        "acl",
        # cross-cutting
        "auth",
        "rbac",
        "audit",
        "security",
        "serdes",
        "sqlguard",
        # packaging + delivery
        "packaging",
        "docker",
        "compose",
        "helm",
        "chart",
        "kustomize",
        "npm",
        "npm-package",
        "pypi",
        "ci",
        "deps",
        "release",
    }
)

MAX_HEADER_LEN = 100  # hard fail — git/GitHub truncate well before this
NICE_HEADER_LEN = 72  # warn — keeps `git log --oneline` and release notes tidy

# <type>(<scope>)!: <description>
HEADER_RE = re.compile(
    r"^(?P<type>[a-zA-Z][a-zA-Z0-9]*)"
    r"(?:\((?P<scope>[^()\r\n]*)\))?"
    r"(?P<breaking>!)?"
    r"(?P<sep>:[ ]?)"
    r"(?P<description>.*)$"
)
SCOPE_RE = re.compile(r"^[a-z0-9]+(?:[-./][a-z0-9]+)*$")
# A footer token is `Token: value` or `Token #value`; `-` replaces whitespace,
# except for the literal `BREAKING CHANGE`.
FOOTER_RE = re.compile(
    r"^(?P<token>BREAKING CHANGE|BREAKING-CHANGE|[A-Za-z0-9-]+)(?P<sep>: | #)(?P<value>.*)$"
)
BREAKING_FOOTER_RE = re.compile(r"^(BREAKING[ -]CHANGE):[ ]?(?P<value>.*)$")
# Messages git itself generates or that are consumed before they ever land.
SKIP_RE = re.compile(r"^(Merge |Revert \"|fixup! |squash! |amend! |Applied changes from )")


@dataclass
class Result:
    """Outcome of one validation run."""

    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    type: str | None = None
    scope: str | None = None
    description: str | None = None
    breaking: bool = False
    skipped: bool = False

    @property
    def ok(self) -> bool:
        return not self.errors

    def error(self, message: str) -> None:
        self.errors.append(message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)


def _strip_comments(message: str) -> str:
    """Drop `#` comment lines and the diff git appends under --verbose."""
    lines: list[str] = []
    for line in message.splitlines():
        if line.startswith("#"):
            continue
        if line.rstrip() == "------------------------ >8 ------------------------":
            break
        lines.append(line)
    return "\n".join(lines).strip("\n")


def validate_header(header: str, result: Result | None = None) -> Result:
    """Validate a single Conventional Commits header line."""
    result = result or Result()
    header = header.rstrip()

    if not header.strip():
        result.error("the header (PR title / commit subject) is empty")
        return result

    match = HEADER_RE.match(header)
    if not match:
        result.error(
            f"header does not match `<type>[(scope)][!]: <description>`: {header!r}\n"
            "        e.g. `feat(topics): add per-partition purge` or "
            "`fix(kafka)!: drop the deprecated offset-reset payload`"
        )
        return result

    raw_type = match.group("type")
    scope = match.group("scope")
    sep = match.group("sep")
    description = match.group("description")
    result.breaking = bool(match.group("breaking"))

    if raw_type != raw_type.lower():
        result.error(f"type must be lower-case: {raw_type!r} → {raw_type.lower()!r}")
    ctype = raw_type.lower()
    result.type = ctype
    if ctype not in TYPES:
        allowed = ", ".join(sorted(TYPES))
        result.error(f"unknown type {raw_type!r}; use one of: {allowed}")

    if scope is not None:
        result.scope = scope
        if scope.strip() == "":
            result.error("empty scope — write `type: description` or `type(scope): description`")
        elif not SCOPE_RE.match(scope):
            result.error(f"scope {scope!r} must be lower-case alphanumerics separated by `-`, `.` or `/`")
        elif scope not in KNOWN_SCOPES:
            result.warn(
                f"scope {scope!r} is not one of the usual scopes — fine if deliberate, "
                "otherwise see KNOWN_SCOPES in scripts/conventional_commit.py"
            )

    if sep != ": ":
        result.error("the separator must be exactly a colon followed by one space (`: `)")

    description = description.strip()
    result.description = description
    if not description:
        result.error("the description after `:` is empty")
    else:
        if description.endswith("."):
            result.error("drop the trailing period from the description")
        if re.match(r"^[A-Z][a-z]", description):
            result.warn(
                f"description starts with a capital letter ({description.split()[0]!r}) — "
                "prefer lower-case, imperative mood (`add`, not `Added`)"
            )
        if re.match(
            r"^(added|adds|fixed|fixes|updated|updates|changed|changes|removed|removes)\b",
            description,
            re.IGNORECASE,
        ):
            result.warn("use the imperative mood in the description (`add`, not `added`/`adds`)")

    if len(header) > MAX_HEADER_LEN:
        result.error(f"header is {len(header)} characters; keep it under {MAX_HEADER_LEN}")
    elif len(header) > NICE_HEADER_LEN:
        result.warn(
            f"header is {len(header)} characters; under {NICE_HEADER_LEN} reads better in "
            "`git log --oneline` and in the generated release notes"
        )

    return result


def validate_message(header: str, body: str | None, *, require_body: bool = False) -> Result:
    """Validate a header plus an optional body/footer block."""
    result = validate_header(header)
    body = (body or "").strip("\n")

    if not body.strip():
        if result.breaking:
            result.error(
                "a `!` breaking change needs a `BREAKING CHANGE: <what broke and what to do>` "
                "footer in the description so it lands in the release notes"
            )
        if require_body:
            result.error(
                "the description is empty — say what changed and why (see .github/pull_request_template.md)"
            )
        return result

    lines = body.splitlines()

    # Footers are the trailing run of paragraphs whose first line is a
    # `Token: value` / `Token #value` footer. Everything before them is body.
    paragraphs: list[list[str]] = [[]]
    for line in lines:
        if line.strip():
            paragraphs[-1].append(line)
        elif paragraphs[-1]:
            paragraphs.append([])
    paragraphs = [paragraph for paragraph in paragraphs if paragraph]

    footer_paragraphs: list[list[str]] = []
    while paragraphs and FOOTER_RE.match(paragraphs[-1][0]):
        footer_paragraphs.insert(0, paragraphs.pop())
    footer_lines = [line for paragraph in footer_paragraphs for line in paragraph]

    def _breaking_value(candidates: list[str]) -> str | None:
        for candidate in candidates:
            match = BREAKING_FOOTER_RE.match(candidate)
            if match:
                return match.group("value").strip()
        return None

    breaking_footer = _breaking_value(footer_lines)
    misplaced = _breaking_value([line for paragraph in paragraphs for line in paragraph])

    if breaking_footer is None and misplaced is not None:
        # release-please still picks this up, but only a real footer renders
        # predictably in the generated release notes.
        result.warn(
            "move `BREAKING CHANGE:` to the very end of the description, as a footer "
            "after a blank line, so it renders as its own release-note section"
        )
        breaking_footer = misplaced

    if breaking_footer is not None:
        result.breaking = True
        if not breaking_footer:
            result.error("`BREAKING CHANGE:` footer has no description")

    if result.breaking and breaking_footer is None:
        result.error(
            "`!` marks this as a breaking change but the description has no "
            "`BREAKING CHANGE: <what broke and what to do>` footer"
        )

    return result


def _report(result: Result, *, label: str, quiet_ok: bool = False) -> int:
    for warning in result.warnings:
        print(f"::warning::{label}: {warning}" if _in_actions() else f"warning: {label}: {warning}")
    if result.errors:
        for error in result.errors:
            print(f"::error::{label}: {error}" if _in_actions() else f"error: {label}: {error}")
        print(_help_text(), file=sys.stderr)
        return 1
    if not quiet_ok:
        summary = result.type or "?"
        if result.scope:
            summary += f"({result.scope})"
        if result.breaking:
            summary += "!"
        print(f"{label}: OK — {summary} → {_bump_for(result)} version bump")
    return 0


def _bump_for(result: Result) -> str:
    if result.breaking:
        return "MAJOR (pre-1.0: MINOR)"
    if result.type == "feat":
        return "MINOR"
    if result.type in RELEASING_TYPES:
        return "PATCH"
    return "no"


def _in_actions() -> bool:
    return os.environ.get("GITHUB_ACTIONS") == "true"


def _help_text() -> str:
    types = "\n".join(f"  {name:<9} {description}" for name, description in TYPES.items())
    return (
        "\nConventional Commits — https://www.conventionalcommits.org/en/v1.0.0/#summary\n\n"
        "  <type>[(optional scope)][!]: <description>\n"
        "  <BLANK LINE>\n"
        "  [optional body]\n"
        "  <BLANK LINE>\n"
        "  [optional footer(s), e.g. `BREAKING CHANGE: ...`, `Refs: #12`]\n\n"
        f"Types:\n{types}\n\n"
        "Examples:\n"
        "  feat(topics): add per-partition purge with a before-offset cutoff\n"
        "  fix(kafka): recycle the watermark consumer after repeated sweep failures\n"
        "  docs(helm): document values-lakestream.yaml\n"
        "  feat(api)!: require an editor token on the OpenLineage endpoint\n"
        "      ...body...\n"
        "      BREAKING CHANGE: external producers must send an editor bearer token.\n"
    )


def _write_job_summary(result: Result, header: str) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    status = "✅ valid" if result.ok else "❌ invalid"
    lines = [
        "## Conventional Commits check",
        "",
        f"**{status}** — `{header}`",
        "",
    ]
    if result.ok:
        lines += [
            f"Merging this pull request will contribute a **{_bump_for(result)}** version bump.",
            "",
        ]
    for error in result.errors:
        lines.append(f"- ❌ {error}")
    for warning in result.warnings:
        lines.append(f"- ⚠️ {warning}")
    if not result.ok:
        lines += [
            "",
            "<details><summary>The rules</summary>",
            "",
            "```",
            _help_text(),
            "```",
            "",
            "</details>",
        ]
    with open(path, "a", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate a Conventional Commits message, PR title or PR body.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=_help_text(),
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--header", help="validate this header line")
    source.add_argument("--commit-msg-file", help="validate a git commit message file (commit-msg hook)")
    source.add_argument(
        "--pr-title", help="validate a pull request title (pairs with --pr-body/--pr-body-file)"
    )
    parser.add_argument("--pr-body", help="pull request description text")
    parser.add_argument("--pr-body-file", help="file holding the pull request description")
    parser.add_argument(
        "--require-body",
        action="store_true",
        help="fail when the body/description is empty (used for pull requests)",
    )
    parser.add_argument("--quiet", action="store_true", help="print nothing when the message is valid")
    args = parser.parse_args(argv)

    if args.commit_msg_file:
        try:
            with open(args.commit_msg_file, encoding="utf-8") as handle:
                raw = handle.read()
        except OSError as exc:  # pragma: no cover - surfaced verbatim to the user
            print(f"error: cannot read {args.commit_msg_file}: {exc}", file=sys.stderr)
            return 2
        message = _strip_comments(raw)
        if not message.strip():
            print("error: empty commit message", file=sys.stderr)
            return 1
        header, _, body = message.partition("\n")
        if SKIP_RE.match(header):
            if not args.quiet:
                print(f"commit message: skipped ({header.split(':')[0][:40]}…)")
            return 0
        result = validate_message(header, body)
        return _report(result, label="commit message", quiet_ok=args.quiet)

    if args.pr_title is not None:
        body = args.pr_body
        if args.pr_body_file:
            try:
                with open(args.pr_body_file, encoding="utf-8") as handle:
                    body = handle.read()
            except OSError as exc:  # pragma: no cover
                print(f"error: cannot read {args.pr_body_file}: {exc}", file=sys.stderr)
                return 2
        title = args.pr_title.strip()
        result = validate_message(title, body, require_body=args.require_body)
        _write_job_summary(result, title)
        return _report(result, label="pull request title", quiet_ok=args.quiet)

    result = validate_header(args.header)
    return _report(result, label="header", quiet_ok=args.quiet)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
