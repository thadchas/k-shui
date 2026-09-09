"""Unit tests for `scripts/generate_release_reference.py`.

Written as `unittest.TestCase` classes so the same file runs under both
runners the repository uses:

    python3 -m unittest discover -s scripts/tests -t scripts/tests   # release-tooling CI
    uv run --project backend pytest ../scripts/tests                 # with k_shui importable

Unlike the rest of `scripts/tests`, these tests need the backend on the import
path (the generator builds the real FastAPI app), so everything that touches it
is skipped — loudly, with a reason — when `k_shui` cannot be imported. The pure
functions (tag/commit validation, redaction, changelog extraction, tar
determinism) always run.
"""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import re
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
REPO_ROOT = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))

import generate_release_reference as g  # noqa: E402

COMMIT = "6a746698869d94cc0603945b4364a51b39e6632d"
OTHER_COMMIT = "0123456789abcdef0123456789abcdef01234567"


def _backend_importable() -> tuple[bool, str]:
    if sys.version_info[:2] < g.MIN_PYTHON:
        return (
            False,
            f"k-shui needs Python {g.MIN_PYTHON[0]}.{g.MIN_PYTHON[1]}+; this is {sys.version.split()[0]}",
        )
    sys.path.insert(0, str(REPO_ROOT / "backend"))
    try:
        import k_shui.main  # noqa: F401
    except Exception as exc:  # missing dependencies, not just a missing module
        return False, f"k_shui is not importable ({exc}); run under `uv run --project backend`"
    return True, ""


BACKEND_OK, BACKEND_WHY = _backend_importable()
needs_backend = unittest.skipUnless(BACKEND_OK, BACKEND_WHY)


# --------------------------------------------------------------------------- #
# input validation — no backend needed
# --------------------------------------------------------------------------- #


class TagAndCommitTests(unittest.TestCase):
    def test_stable_tag(self) -> None:
        self.assertEqual(g.parse_tag("v0.2.0"), ("0.2.0", False))

    def test_prerelease_tag(self) -> None:
        self.assertEqual(g.parse_tag("v1.4.0-rc.1"), ("1.4.0-rc.1", True))

    def test_tag_must_be_v_prefixed(self) -> None:
        with self.assertRaisesRegex(g.GenerationError, "v-prefixed"):
            g.parse_tag("0.2.0")

    def test_tag_must_be_semver(self) -> None:
        for bad in ("v1", "v1.2", "v1.2.3.4", "vlatest", "v01.2.3"):
            with self.subTest(tag=bad), self.assertRaises(g.GenerationError):
                g.parse_tag(bad)

    def test_build_metadata_is_rejected(self) -> None:
        # Docker tags cannot contain '+', so release.yml refuses these too.
        with self.assertRaisesRegex(g.GenerationError, "build metadata"):
            g.parse_tag("v1.2.3+build.5")

    def test_commit_must_be_forty_lower_hex(self) -> None:
        self.assertEqual(g.parse_commit(COMMIT), COMMIT)
        for bad in ("", "abc", COMMIT[:39], COMMIT.upper(), COMMIT + "0", "z" * 40):
            with self.subTest(commit=bad), self.assertRaises(g.GenerationError):
                g.parse_commit(bad)

    def test_cli_rejects_a_bad_tag_without_writing_anything(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            code = g.main(["--tag", "0.2.0", "--commit", COMMIT, "--output-dir", tmp])
            self.assertEqual(code, 1)
            self.assertEqual(sorted(Path(tmp).iterdir()), [])

    def test_cli_rejects_a_bad_commit_without_writing_anything(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            code = g.main(["--tag", "v0.2.0", "--commit", "nope", "--output-dir", tmp])
            self.assertEqual(code, 1)
            self.assertEqual(sorted(Path(tmp).iterdir()), [])


# --------------------------------------------------------------------------- #
# redaction — no backend needed
# --------------------------------------------------------------------------- #


class RedactionTests(unittest.TestCase):
    def test_every_secret_key_is_redacted_at_any_depth(self) -> None:
        payload = {
            "auth": {
                "jwtSecret": "s3cret",
                "users": [{"username": "ada", "password": "argon2$hash", "role": "admin"}],
                "oidc": {"issuer": "https://idp", "clientId": "k-shui", "clientSecret": "oidc-secret"},
            },
            "clusters": [
                {
                    "id": "prod",
                    "schemaRegistry": {"url": "https://sr", "auth": {"password": "p", "bearerToken": "b"}},
                }
            ],
            "agent": {"connections": [{"id": "a", "apiKeyEnv": "OPENAI_API_KEY"}]},
        }
        out = g.redact(payload)
        flat = json.dumps(out)
        for leaked in ("s3cret", "argon2$hash", "oidc-secret", '"p"', '"b"', "OPENAI_API_KEY"):
            self.assertNotIn(leaked, flat, f"{leaked} survived redaction")
        # Keys and structure survive; only values change.
        self.assertEqual(out["auth"]["jwtSecret"], g.REDACTED)
        self.assertEqual(out["auth"]["users"][0]["password"], g.REDACTED)
        self.assertEqual(out["auth"]["users"][0]["username"], "ada")
        self.assertEqual(out["auth"]["oidc"]["clientSecret"], g.REDACTED)
        self.assertEqual(out["auth"]["oidc"]["clientId"], "k-shui")
        self.assertEqual(out["clusters"][0]["schemaRegistry"]["auth"]["bearerToken"], g.REDACTED)
        self.assertEqual(out["clusters"][0]["schemaRegistry"]["url"], "https://sr")
        self.assertEqual(out["agent"]["connections"][0]["apiKeyEnv"], g.REDACTED)

    def test_null_secrets_stay_null(self) -> None:
        self.assertEqual(g.redact({"password": None}), {"password": None})

    def test_schema_defaults_for_secret_fields_are_redacted(self) -> None:
        schema = {
            "$defs": {
                "HttpAuth": {
                    "properties": {
                        "username": {"type": "string", "default": "svc"},
                        "password": {"type": "string", "default": "hunter2", "examples": ["hunter2"]},
                    }
                }
            }
        }
        out = g.redact_schema(schema)
        props = out["$defs"]["HttpAuth"]["properties"]
        self.assertEqual(props["username"]["default"], "svc")
        self.assertEqual(props["password"]["default"], g.REDACTED)
        self.assertEqual(props["password"]["examples"], [g.REDACTED])
        self.assertEqual(props["password"]["type"], "string")


# --------------------------------------------------------------------------- #
# changelog extraction — no backend needed
# --------------------------------------------------------------------------- #


CHANGELOG = """# Changelog

Preamble that is never part of a section.

## [0.2.0](https://github.com/thadchas/k-shui/compare/v0.1.0...v0.2.0) (2026-09-10)

### Features

* something

## [0.1.0]

The first release.

[0.1.0]: https://github.com/thadchas/k-shui/releases/tag/v0.1.0
"""


class ChangelogTests(unittest.TestCase):
    def test_extracts_a_release_please_section(self) -> None:
        section = g._changelog_section(CHANGELOG, "0.2.0")
        assert section is not None
        self.assertTrue(section.startswith("## [0.2.0]"))
        self.assertIn("* something", section)
        self.assertNotIn("## [0.1.0]", section)
        self.assertNotIn("Preamble", section)
        self.assertTrue(section.endswith("\n"))

    def test_extracts_the_last_section_to_end_of_file(self) -> None:
        section = g._changelog_section(CHANGELOG, "0.1.0")
        assert section is not None
        self.assertTrue(section.startswith("## [0.1.0]"))
        self.assertIn("releases/tag/v0.1.0", section)

    def test_a_prefix_match_is_not_a_match(self) -> None:
        self.assertIsNone(g._changelog_section(CHANGELOG, "0.1"))
        self.assertIsNone(g._changelog_section(CHANGELOG, "0.2.0-rc.1"))

    def test_missing_version_produces_an_explicit_stub(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "CHANGELOG.md").write_text(CHANGELOG, encoding="utf-8")
            notes = g.render_release_notes("9.9.9", "v9.9.9", COMMIT, root)
        self.assertIn("carries no section for 9.9.9", notes)
        self.assertIn("releases/tag/v9.9.9", notes)
        self.assertIn(COMMIT, notes)

    def test_the_repository_changelog_yields_the_real_section(self) -> None:
        notes = g.render_release_notes("0.1.0", "v0.1.0", COMMIT, REPO_ROOT)
        self.assertTrue(notes.startswith("## [0.1.0]"))
        self.assertNotIn("carries no section", notes)


# --------------------------------------------------------------------------- #
# tarball determinism — no backend needed
# --------------------------------------------------------------------------- #


class TarballTests(unittest.TestCase):
    FILES = {"b.json": b"{}\n", "a.md": b"# a\n", "c.txt": b"c\n"}

    def test_bytes_are_reproducible(self) -> None:
        first = g.tar_gz_bytes(self.FILES, "root")
        second = g.tar_gz_bytes(dict(reversed(list(self.FILES.items()))), "root")
        self.assertEqual(first, second, "member insertion order leaked into the tarball")

    def test_gzip_header_carries_no_timestamp_or_filename(self) -> None:
        blob = g.tar_gz_bytes(self.FILES, "root")
        self.assertEqual(blob[4:8], b"\x00\x00\x00\x00", "gzip MTIME is not zero")
        self.assertEqual(blob[3] & 0x08, 0, "gzip header carries an original filename")

    def test_members_are_sorted_under_one_root_and_carry_no_identity(self) -> None:
        blob = g.tar_gz_bytes(self.FILES, "k-shui-docs-reference-v0.2.0")
        with tarfile.open(fileobj=io.BytesIO(gzip.decompress(blob))) as tar:
            members = tar.getmembers()
        self.assertEqual(
            [m.name for m in members],
            [
                "k-shui-docs-reference-v0.2.0",
                "k-shui-docs-reference-v0.2.0/a.md",
                "k-shui-docs-reference-v0.2.0/b.json",
                "k-shui-docs-reference-v0.2.0/c.txt",
            ],
        )
        for member in members:
            with self.subTest(member=member.name):
                self.assertEqual(member.mtime, 0)
                self.assertEqual((member.uid, member.gid), (0, 0))
                self.assertEqual((member.uname, member.gname), ("", ""))


# --------------------------------------------------------------------------- #
# the bundle itself — needs the backend
# --------------------------------------------------------------------------- #


@needs_backend
class BundleTests(unittest.TestCase):
    tag = "v0.2.0"

    @classmethod
    def setUpClass(cls) -> None:
        cls.files = g.build_reference(cls.tag, COMMIT, REPO_ROOT)
        cls.manifest = json.loads(cls.files["manifest.json"])

    def test_bundle_holds_exactly_the_contracted_members(self) -> None:
        self.assertEqual(sorted(self.files), sorted([*g.MEMBERS, "manifest.json"]))

    def test_manifest_source_identifies_the_release(self) -> None:
        self.assertEqual(self.manifest["schemaVersion"], 1)
        self.assertEqual(self.manifest["generator"], "scripts/generate_release_reference.py")
        self.assertEqual(self.manifest["generatorVersion"], 1)
        self.assertEqual(
            self.manifest["source"],
            {
                "repository": "thadchas/k-shui",
                "tag": "v0.2.0",
                "commit": COMMIT,
                "version": "0.2.0",
                "prerelease": False,
            },
        )

    def test_manifest_checksums_and_sizes_are_correct(self) -> None:
        listed = self.manifest["files"]
        self.assertEqual([entry["path"] for entry in listed], sorted(g.MEMBERS))
        for entry in listed:
            with self.subTest(path=entry["path"]):
                payload = self.files[entry["path"]]
                self.assertEqual(entry["sha256"], hashlib.sha256(payload).hexdigest())
                self.assertEqual(entry["bytes"], len(payload))

    def test_manifest_does_not_list_itself(self) -> None:
        self.assertNotIn("manifest.json", [entry["path"] for entry in self.manifest["files"]])

    def test_json_members_are_sorted_indented_and_lf_terminated(self) -> None:
        for name in ("manifest.json", "openapi.json", "configuration.json", "install.json"):
            with self.subTest(name=name):
                raw = self.files[name]
                self.assertNotIn(b"\r", raw)
                self.assertTrue(raw.endswith(b"\n"))
                self.assertEqual(raw, g.json_bytes(json.loads(raw)))

    def test_openapi_is_the_application_document(self) -> None:
        spec = json.loads(self.files["openapi.json"])
        self.assertTrue(spec["openapi"].startswith("3."))
        self.assertEqual(spec["info"]["title"], "k-shui")
        self.assertIn("/api/v1/info", spec["paths"])

    def test_configuration_is_schema_plus_redacted_defaults(self) -> None:
        payload = json.loads(self.files["configuration.json"])
        self.assertEqual(sorted(payload), ["defaults", "schema"])
        self.assertEqual(payload["schema"]["title"], "Settings")
        self.assertIn("ClusterConfig", payload["schema"]["$defs"])
        self.assertEqual(payload["defaults"]["clusters"], [])
        self.assertIsNone(payload["defaults"]["configPath"])
        self.assertIsNone(payload["defaults"]["auth"]["jwtSecret"])

    def test_configuration_markdown_is_generated_from_the_schema(self) -> None:
        text = self.files["configuration.md"].decode()
        self.assertTrue(text.startswith("# k-shui configuration reference"))
        self.assertIn("scripts/generate_release_reference.py", text)
        self.assertIn(COMMIT, text)
        for block in (
            "## server",
            "## auth",
            "## database",
            "## telemetry",
            "## alerts",
            "## agent",
            "## clusters",
        ):
            self.assertIn(block, text)
        self.assertIn("### HttpAuth", text)
        self.assertIn("| `bootstrapServers` | string | **required** |", text)
        self.assertIn("| `port` | integer | `8090` |", text)
        self.assertIn("`KSHUI__SERVER__PORT=9000`", text)

    def test_no_wall_clock_leaks_into_the_bundle(self) -> None:
        import datetime

        year = str(datetime.date.today().year).encode()
        # The changelog stub and the schema never carry a date; the only place a
        # year could appear is a timestamp the generator invented.
        self.assertNotIn(year, self.files["install.json"])
        self.assertNotIn(year, self.files["manifest.json"])
        self.assertNotIn(year, self.files["configuration.json"])


@needs_backend
class InstallMatrixTests(unittest.TestCase):
    def install(self, tag: str) -> dict:
        version, prerelease = g.parse_tag(tag)
        return g.render_install(tag, version, prerelease, REPO_ROOT)

    def test_stable_release(self) -> None:
        payload = self.install("v0.2.0")
        self.assertEqual(payload["version"], "0.2.0")
        self.assertEqual(payload["tag"], "v0.2.0")
        self.assertFalse(payload["prerelease"])
        self.assertEqual(payload["artifacts"]["npm"]["distTag"], "latest")
        self.assertEqual(payload["artifacts"]["pypi"]["command"], "uvx k-shui@0.2.0 serve")
        self.assertEqual(payload["artifacts"]["image"]["reference"], "ghcr.io/thadchas/k-shui:0.2.0")
        self.assertEqual(payload["artifacts"]["helm"]["version"], "0.2.0")
        self.assertEqual(sorted(payload["requirements"]), ["node", "python"])

    def test_prerelease_never_claims_latest(self) -> None:
        payload = self.install("v0.2.0-rc.1")
        self.assertTrue(payload["prerelease"])
        self.assertEqual(payload["artifacts"]["npm"]["distTag"], "next")
        # `latest` must not appear anywhere: not as an npm dist-tag, and not as
        # an image tag. Every reference pins the exact prerelease version.
        self.assertNotIn("latest", json.dumps(payload))
        self.assertEqual(payload["artifacts"]["image"]["reference"], "ghcr.io/thadchas/k-shui:0.2.0-rc.1")

    def test_the_contracted_shape_is_exact(self) -> None:
        payload = self.install("v0.2.0")
        self.assertEqual(sorted(payload), ["artifacts", "prerelease", "requirements", "tag", "version"])
        artifacts = payload["artifacts"]
        self.assertEqual(sorted(artifacts), ["helm", "image", "npm", "pypi"])
        self.assertEqual(sorted(artifacts["pypi"]), ["command", "package"])
        self.assertEqual(sorted(artifacts["npm"]), ["command", "distTag", "package"])
        self.assertEqual(sorted(artifacts["image"]), ["command", "reference"])
        self.assertEqual(sorted(artifacts["helm"]), ["chart", "command", "version"])


@needs_backend
class DeterminismTests(unittest.TestCase):
    def test_two_full_runs_produce_identical_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as one, tempfile.TemporaryDirectory() as two:
            first = g.generate("v0.2.0", COMMIT, Path(one), REPO_ROOT)
            second = g.generate("v0.2.0", COMMIT, Path(two), REPO_ROOT)
            for a, b in zip(first, second, strict=True):
                if a.is_dir():
                    names_a = sorted(p.name for p in a.iterdir())
                    self.assertEqual(names_a, sorted(p.name for p in b.iterdir()))
                    for name in names_a:
                        with self.subTest(name=name):
                            self.assertEqual(
                                hashlib.sha256((a / name).read_bytes()).hexdigest(),
                                hashlib.sha256((b / name).read_bytes()).hexdigest(),
                            )
                else:
                    with self.subTest(name=a.name):
                        self.assertEqual(
                            hashlib.sha256(a.read_bytes()).hexdigest(),
                            hashlib.sha256(b.read_bytes()).hexdigest(),
                        )

    def test_the_checksum_file_matches_the_tarball(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _, tarball, checksum = g.generate("v0.2.0", COMMIT, Path(tmp), REPO_ROOT)
            digest, name = checksum.read_text(encoding="utf-8").split()
            self.assertEqual(digest, hashlib.sha256(tarball.read_bytes()).hexdigest())
            self.assertEqual(name, tarball.name)

    def test_a_different_commit_changes_the_bundle(self) -> None:
        # Determinism must not be indifference: the recorded identity is real.
        a = g.build_reference("v0.2.0", COMMIT, REPO_ROOT)
        b = g.build_reference("v0.2.0", OTHER_COMMIT, REPO_ROOT)
        self.assertNotEqual(a["manifest.json"], b["manifest.json"])
        self.assertEqual(a["openapi.json"], b["openapi.json"])

    def test_cli_check_flag_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            code = g.main(["--tag", "v0.2.0", "--commit", COMMIT, "--output-dir", tmp, "--check"])
        self.assertEqual(code, 0)


@needs_backend
class IsolationTests(unittest.TestCase):
    """No deployment configuration, no lifespan, no side effects."""

    def setUp(self) -> None:
        self._environ = dict(os.environ)
        self.addCleanup(self._restore)

    def _restore(self) -> None:
        os.environ.clear()
        os.environ.update(self._environ)

    def test_no_configuration_file_is_read_and_no_cluster_is_configured(self) -> None:
        settings = g.build_settings(REPO_ROOT)
        self.assertIsNone(settings.configPath, "a deployment configuration file was read")
        self.assertEqual(settings.clusters, [], "a cluster was configured")
        self.assertIsNone(settings.auth.jwtSecret)
        self.assertEqual(os.environ["KSHUI_CONFIG"], str(g._absent_config_path(REPO_ROOT)))
        self.assertFalse(Path(os.environ["KSHUI_CONFIG"]).exists())

    def test_environment_overrides_are_stripped_not_honoured(self) -> None:
        os.environ["KSHUI__SERVER__PORT"] = "1234"
        os.environ["KSHUI__DATABASE__URL"] = "postgresql+asyncpg://user:pw@db/k-shui"
        os.environ["KSHUI_BOOTSTRAP_SERVERS"] = "broker.internal:9092"
        dropped = g.isolate_environment(REPO_ROOT)
        self.assertEqual(
            dropped,
            ["KSHUI_BOOTSTRAP_SERVERS", "KSHUI__DATABASE__URL", "KSHUI__SERVER__PORT"],
        )
        settings = g.build_settings(REPO_ROOT)
        self.assertEqual(settings.server.port, 8090)
        self.assertEqual(settings.database.url, "sqlite+aiosqlite:///./k-shui.db")

    def test_a_deployment_secret_in_the_environment_never_reaches_the_bundle(self) -> None:
        os.environ["KSHUI__AUTH__JWTSECRET"] = "leaked-jwt-secret"
        files = g.build_reference("v0.2.0", COMMIT, REPO_ROOT)
        for name, payload in files.items():
            with self.subTest(name=name):
                self.assertNotIn(b"leaked-jwt-secret", payload)

    def test_lifespan_work_never_runs(self) -> None:
        import k_shui.agent.service as agent_service
        import k_shui.main as main_module
        from k_shui.db import session as db_session

        called: list[str] = []

        def boom(name: str):
            def _fail(*_args, **_kwargs):
                called.append(name)
                raise AssertionError(f"{name} was invoked while generating the reference bundle")

            return _fail

        for module, attribute in (
            (db_session, "init_db"),
            (main_module, "SamplerManager"),
            (agent_service, "recover_interrupted_runs"),
        ):
            original = getattr(module, attribute)
            setattr(module, attribute, boom(f"{module.__name__}.{attribute}"))
            self.addCleanup(setattr, module, attribute, original)

        app = g.build_app(repo_root=REPO_ROOT)

        self.assertEqual(called, [])
        self.assertFalse(db_session.is_ready())
        self.assertIsNone(db_session.get_engine())
        self.assertIsNone(app.state.samplers)
        self.assertFalse(hasattr(app.state, "bus"))
        self.assertIsNone(getattr(app.state, "alert_engine", None))
        self.assertEqual(app.state.registry.ids(), [])
        self.assertFalse((REPO_ROOT / "k-shui.db").exists(), "a SQLite database was created")

    def test_assert_no_lifespan_rejects_a_started_app(self) -> None:
        app = g.build_app(repo_root=REPO_ROOT)
        app.state.samplers = object()
        with self.assertRaisesRegex(g.GenerationError, "SamplerManager"):
            g.assert_no_lifespan(app, REPO_ROOT)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()


# --------------------------------------------------------------------------- #
# configuration.md must not link at headings it never emits
# --------------------------------------------------------------------------- #


@needs_backend
class ConfigurationAnchorTests(unittest.TestCase):
    """Every internal link in `configuration.md` must resolve to a heading it emits.

    A block is headed by its config key (`## server`) while its schema type is named
    `ServerConfig`, so linking a `$ref` by type name silently produced seven dead
    anchors — invisible in the generator, fatal in the docs site's link checker.
    """

    @staticmethod
    def _slug(text: str) -> str:
        text = re.sub(r"[^a-z0-9 -]", "", text.strip().lower())
        return re.sub(r"\s+", "-", text)

    def test_every_internal_anchor_resolves(self) -> None:
        markdown = g.build_reference("v0.2.0", COMMIT, REPO_ROOT)["configuration.md"].decode()
        headings = {self._slug(m.group(1)) for m in re.finditer(r"^#{2,4}\s+(.+)$", markdown, re.M)}
        links = {m.group(1) for m in re.finditer(r"\(#([a-z0-9-]+)\)", markdown)}
        self.assertTrue(links, "configuration.md should cross-link its referenced types")
        self.assertEqual(sorted(links - headings), [], "configuration.md links at missing headings")

    def test_top_level_blocks_are_linked_by_their_config_key(self) -> None:
        markdown = g.build_reference("v0.2.0", COMMIT, REPO_ROOT)["configuration.md"].decode()
        # `server` is emitted as `## server`, so references to ServerConfig point there.
        self.assertIn("[`ServerConfig`](#server)", markdown)
        self.assertNotIn("(#serverconfig)", markdown)
        # A type that only ever appears nested keeps its own name as the heading.
        self.assertIn("### HttpAuth", markdown)
        self.assertIn("(#httpauth)", markdown)
