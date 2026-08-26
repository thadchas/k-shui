"""Unit tests for the release tooling in `scripts/`.

Stdlib-only so they run anywhere `python3` does:

    python3 -m unittest discover -s scripts/tests -t scripts/tests
"""

from __future__ import annotations

import io
import sys
import textwrap
import unittest
from contextlib import redirect_stdout
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

import check_versions  # noqa: E402
import conventional_commit as cc  # noqa: E402


class HeaderTests(unittest.TestCase):
    def assert_valid(self, header: str) -> cc.Result:
        result = cc.validate_header(header)
        self.assertTrue(result.ok, f"expected {header!r} to be valid, got {result.errors}")
        return result

    def assert_invalid(self, header: str, contains: str = "") -> cc.Result:
        result = cc.validate_header(header)
        self.assertFalse(result.ok, f"expected {header!r} to be rejected")
        if contains:
            self.assertTrue(
                any(contains in error for error in result.errors),
                f"expected an error mentioning {contains!r}, got {result.errors}",
            )
        return result

    def test_minimal_header(self) -> None:
        result = self.assert_valid("fix: stop the watermark consumer wedging")
        self.assertEqual(result.type, "fix")
        self.assertIsNone(result.scope)
        self.assertFalse(result.breaking)

    def test_scoped_header(self) -> None:
        result = self.assert_valid("feat(topics): add per-partition purge")
        self.assertEqual((result.type, result.scope), ("feat", "topics"))

    def test_bang_marks_breaking(self) -> None:
        result = cc.validate_header("feat(api)!: require an editor token")
        self.assertTrue(result.breaking)

    def test_every_documented_type_is_accepted(self) -> None:
        for ctype in cc.TYPES:
            self.assert_valid(f"{ctype}: something that changed")

    def test_unknown_type_rejected(self) -> None:
        self.assert_invalid("feet: add a thing", contains="unknown type")

    def test_upper_case_type_rejected(self) -> None:
        self.assert_invalid("Feat: add a thing", contains="lower-case")

    def test_missing_colon_rejected(self) -> None:
        self.assert_invalid("feat add a thing", contains="does not match")

    def test_missing_space_after_colon_rejected(self) -> None:
        self.assert_invalid("feat:add a thing", contains="colon followed by one space")

    def test_empty_description_rejected(self) -> None:
        self.assert_invalid("feat: ", contains="empty")

    def test_empty_scope_rejected(self) -> None:
        self.assert_invalid("feat(): add a thing", contains="empty scope")

    def test_upper_case_scope_rejected(self) -> None:
        self.assert_invalid("feat(Topics): add a thing", contains="lower-case")

    def test_trailing_period_rejected(self) -> None:
        self.assert_invalid("feat: add a thing.", contains="trailing period")

    def test_over_long_header_rejected(self) -> None:
        self.assert_invalid(f"feat: {'x' * cc.MAX_HEADER_LEN}", contains="characters")

    def test_long_header_only_warns(self) -> None:
        header = "feat: " + "x" * (cc.NICE_HEADER_LEN + 2)
        result = cc.validate_header(header)
        self.assertTrue(result.ok)
        self.assertTrue(any("reads better" in warning for warning in result.warnings))

    def test_unknown_scope_only_warns(self) -> None:
        result = cc.validate_header("feat(warp-drive): engage")
        self.assertTrue(result.ok)
        self.assertTrue(any("usual scopes" in warning for warning in result.warnings))

    def test_past_tense_only_warns(self) -> None:
        result = cc.validate_header("feat: added a thing")
        self.assertTrue(result.ok)
        self.assertTrue(any("imperative" in warning for warning in result.warnings))

    def test_repo_history_style_headers(self) -> None:
        for header in (
            "fix(kafka): recycle wedged watermark consumer after repeated sweeps",
            "chore(ci): bump docker/login-action from 3 to 4",
            "docs(readme): vendor-neutral pitch",
            "test: render CLI help deterministically",
            "chore(release): v0.2.0",
        ):
            self.assert_valid(header)


class BumpTests(unittest.TestCase):
    def test_bump_levels(self) -> None:
        cases = {
            "feat: a": "MINOR",
            "fix: a": "PATCH",
            "perf: a": "PATCH",
            "revert: a": "PATCH",
            "docs: a": "PATCH",
            "chore: a": "no",
            "ci: a": "no",
        }
        for header, expected in cases.items():
            self.assertEqual(cc._bump_for(cc.validate_header(header)), expected, header)

    def test_breaking_beats_type(self) -> None:
        self.assertIn("MAJOR", cc._bump_for(cc.validate_header("fix!: a")))


class MessageTests(unittest.TestCase):
    def test_bang_requires_a_breaking_footer(self) -> None:
        result = cc.validate_message("feat(api)!: require an editor token", "Some body text.")
        self.assertFalse(result.ok)
        self.assertTrue(any("BREAKING CHANGE" in error for error in result.errors))

    def test_bang_with_footer_is_valid(self) -> None:
        body = textwrap.dedent(
            """\
            Lineage ingestion is no longer anonymous.

            BREAKING CHANGE: external OpenLineage producers must send an editor token.
            """
        )
        result = cc.validate_message("feat(api)!: require an editor token", body)
        self.assertTrue(result.ok, result.errors)
        self.assertTrue(result.breaking)

    def test_footer_alone_marks_breaking(self) -> None:
        result = cc.validate_message("feat(api): tighten lineage auth", "BREAKING CHANGE: send a token.")
        self.assertTrue(result.ok, result.errors)
        self.assertTrue(result.breaking)

    def test_breaking_change_mid_body_warns_but_passes(self) -> None:
        body = textwrap.dedent(
            """\
            BREAKING CHANGE: external producers must send an editor token.

            Some trailing prose that pushes the note out of the footer block.
            """
        )
        result = cc.validate_message("feat(api)!: tighten lineage auth", body)
        self.assertTrue(result.ok, result.errors)
        self.assertTrue(any("footer" in warning for warning in result.warnings))

    def test_empty_breaking_footer_rejected(self) -> None:
        result = cc.validate_message("feat: a", "BREAKING CHANGE:")
        self.assertFalse(result.ok)

    def test_require_body_rejects_an_empty_description(self) -> None:
        result = cc.validate_message("feat: a thing", "", require_body=True)
        self.assertFalse(result.ok)
        self.assertTrue(any("empty" in error for error in result.errors))

    def test_markdown_pr_body_is_accepted(self) -> None:
        body = textwrap.dedent(
            """\
            ## What & why

            - live tail for the message browser
            - `?mode=tail` follows partitions until you stop

            Refs: #42
            """
        )
        result = cc.validate_message("feat(messages): add live tail", body, require_body=True)
        self.assertTrue(result.ok, result.errors)
        self.assertFalse(result.breaking)


class CliTests(unittest.TestCase):
    def run_cli(self, argv: list[str]) -> tuple[int, str]:
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = cc.main(argv)
        return code, buffer.getvalue()

    def test_valid_header_exits_zero(self) -> None:
        code, out = self.run_cli(["--header", "feat(topics): add purge"])
        self.assertEqual(code, 0)
        self.assertIn("MINOR", out)

    def test_invalid_header_exits_one(self) -> None:
        code, _ = self.run_cli(["--header", "nope"])
        self.assertEqual(code, 1)

    def test_commit_msg_file(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "COMMIT_EDITMSG"
            path.write_text(
                "feat(topics): add purge\n\n# comments are stripped\nBody line.\n",
                encoding="utf-8",
            )
            self.assertEqual(self.run_cli(["--commit-msg-file", str(path)])[0], 0)

    def test_merge_commits_are_skipped(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "COMMIT_EDITMSG"
            path.write_text("Merge branch 'main' into feature\n", encoding="utf-8")
            self.assertEqual(self.run_cli(["--commit-msg-file", str(path)])[0], 0)

    def test_pr_title_and_body(self) -> None:
        code, _ = self.run_cli(
            ["--pr-title", "feat(topics): add purge", "--pr-body", "Why: operators asked.", "--require-body"]
        )
        self.assertEqual(code, 0)


class VersionTests(unittest.TestCase):
    def test_repo_versions_agree(self) -> None:
        """The real repository must be internally consistent."""
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = check_versions.check(None)
        self.assertEqual(code, 0, buffer.getvalue())

    def test_every_site_is_readable(self) -> None:
        for site in check_versions.SITES:
            version, _ = check_versions.read_site(site)
            self.assertRegex(version, r"^\d+\.\d+\.\d+")

    def test_canonical_site_is_version_txt(self) -> None:
        self.assertEqual(check_versions.SITES[0].path, "version.txt")

    def test_semver_parsing(self) -> None:
        for good in ("0.1.0", "1.0.0", "1.4.0-rc.1", "1.4.0+build.5"):
            self.assertIsNotNone(check_versions.SEMVER_RE.match(good), good)
        for bad in ("1.0", "v1.0.0", "1.0.0.0", "01.0.0", ""):
            self.assertIsNone(check_versions.SEMVER_RE.match(bad), bad)

    def test_mismatch_is_reported(self) -> None:
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = check_versions.check("9.9.9")
        self.assertEqual(code, 1)
        self.assertIn("9.9.9", buffer.getvalue())


class ReleasePleaseConfigTests(unittest.TestCase):
    """The config and the checker must agree on which files carry the version."""

    def setUp(self) -> None:
        import json

        root = SCRIPTS.parent
        self.config = json.loads((root / "release-please-config.json").read_text(encoding="utf-8"))
        self.manifest = json.loads((root / ".release-please-manifest.json").read_text(encoding="utf-8"))
        self.package = self.config["packages"]["."]

    def test_manifest_matches_the_repository_version(self) -> None:
        self.assertEqual(self.manifest["."], check_versions.read_site(check_versions.SITES[0])[0])

    def test_release_please_bumps_every_non_canonical_site(self) -> None:
        # version.txt is handled by the `simple` release type itself.
        managed = set()
        for entry in self.package["extra-files"]:
            managed.add(entry if isinstance(entry, str) else entry["path"])
        expected = {site.path for site in check_versions.SITES if site.path != "version.txt"}
        self.assertEqual(
            expected - managed,
            set(),
            "these files declare a version that release-please would not bump",
        )

    def test_release_pr_title_is_itself_conventional(self) -> None:
        pattern = self.config["pull-request-title-pattern"]
        result = cc.validate_header(pattern.replace("${version}", "1.2.3").replace("${scope}", "main"))
        self.assertTrue(result.ok, f"release PR title would fail pr-lint: {result.errors}")

    def test_pre_one_dot_zero_breaking_changes_bump_minor(self) -> None:
        self.assertTrue(self.config["bump-minor-pre-major"])

    def test_changelog_sections_only_use_known_types(self) -> None:
        for section in self.package["changelog-sections"]:
            self.assertIn(section["type"], cc.TYPES)

    def test_visible_changelog_sections_are_exactly_the_releasing_types(self) -> None:
        visible = {s["type"] for s in self.package["changelog-sections"] if not s.get("hidden")}
        self.assertEqual(
            visible,
            set(cc.RELEASING_TYPES),
            "RELEASING_TYPES and the non-hidden changelog-sections have drifted apart",
        )

    def test_every_type_has_a_changelog_section(self) -> None:
        configured = {s["type"] for s in self.package["changelog-sections"]}
        self.assertEqual(configured, set(cc.TYPES))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
