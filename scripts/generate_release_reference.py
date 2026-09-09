#!/usr/bin/env python3
"""Generate the release reference bundle consumed by `thadchas/k-shui-docs`.

One release ships a documentation *reference* — the OpenAPI document, the
configuration schema and its rendered reference, the install matrix, and the
changelog section — frozen from the exact commit that was published. The docs
repository never imports the application source; it imports this bundle,
verifies its checksums, and files it under `versions/<tag>/reference/`.

    python3 scripts/generate_release_reference.py \\
        --tag v0.2.0 --commit <40 hex> --output-dir dist/reference

writes

    dist/reference/k-shui-docs-reference-v0.2.0/{manifest,openapi,configuration,install}.json
    dist/reference/k-shui-docs-reference-v0.2.0/{configuration,release-notes}.md
    dist/reference/k-shui-docs-reference-v0.2.0.tar.gz
    dist/reference/k-shui-docs-reference-v0.2.0.tar.gz.sha256

Two hard rules make the bundle trustworthy:

**No side effects.** The FastAPI application is *constructed*, never *started*:
`lifespan` is not entered, so there is no database, no `SamplerManager`, no
alert engine, no interrupted-run recovery and no Kafka client anywhere. The
settings object is built from in-code defaults only — `KSHUI_CONFIG` is pointed
at a path that cannot exist and every `KSHUI__*` variable is removed from the
environment first — so a deployment's YAML file and its secrets can never leak
into a published document. Both facts are asserted, not assumed.

**Determinism.** Identical input commit, identical bytes. Nothing reads the
wall clock; JSON is `sort_keys=True, indent=2`, LF, trailing newline; the
tarball is written with sorted members, `mtime=0`, `uid=gid=0`, empty owner
names, and a gzip header whose own `mtime` is 0. `--check` proves it by
generating twice and comparing byte for byte.

Exit code 0 = bundle written (and, with `--check`, reproducible), 1 = failure.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import re
import sys
import tarfile
import tempfile
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from check_versions import SEMVER_RE  # noqa: E402  — one semver definition for the repo

SCHEMA_VERSION = 1
GENERATOR = "scripts/generate_release_reference.py"
GENERATOR_VERSION = 1
REPOSITORY = "thadchas/k-shui"
BUNDLE_STEM = "k-shui-docs-reference-"

COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")

#: The application itself requires 3.11+; so does this generator, because it
#: imports it. Kept as a constant so the check reads as a runtime guard rather
#: than a compatibility shim for an interpreter this file never targets.
MIN_PYTHON = (3, 11)

REDACTED = "<redacted>"

#: Keys whose *values* never appear in a published document. Structure and key
#: names are preserved so the reference still documents that the field exists.
#: `apiKeyEnv` only names an environment variable, but naming a deployment's
#: variables is still deployment detail, so it is redacted with the rest.
SECRET_KEYS = frozenset(
    {
        "jwtSecret",
        "clientSecret",
        "password",
        "bearerToken",
        "apiKeyEnv",
        "secret",
        "token",
    }
)

#: Bundle members, in the order the manifest and the tarball list them.
MEMBERS = (
    "configuration.json",
    "configuration.md",
    "install.json",
    "openapi.json",
    "release-notes.md",
)

IMAGE_REPOSITORY = "ghcr.io/thadchas/k-shui"
HELM_CHART = "oci://ghcr.io/thadchas/charts/k-shui"
PYPI_PACKAGE = "k-shui"
NPM_PACKAGE = "k-shui"


class GenerationError(RuntimeError):
    """Anything that must stop the generator with a non-zero exit code."""


# --------------------------------------------------------------------------- #
# input validation
# --------------------------------------------------------------------------- #


def parse_tag(tag: str) -> tuple[str, bool]:
    """Return `(version, prerelease)` for a publishable tag, or raise.

    Mirrors the `resolve` job in `.github/workflows/release.yml`: a v-prefixed
    semantic version, and never build metadata (a Docker tag cannot hold `+`).
    """
    if not tag.startswith("v"):
        raise GenerationError(f"tag {tag!r} is not v-prefixed (expected e.g. v0.2.0)")
    version = tag[1:]
    match = SEMVER_RE.match(version)
    if not match:
        raise GenerationError(f"tag {tag!r} is not a v-prefixed Semantic Version (https://semver.org)")
    if match.group("buildmetadata"):
        raise GenerationError(f"tag {tag!r} carries build metadata, which is not publishable")
    return version, bool(match.group("prerelease"))


def parse_commit(commit: str) -> str:
    if not COMMIT_RE.match(commit):
        raise GenerationError(f"commit {commit!r} is not a 40-character lower-case hex sha")
    return commit


# --------------------------------------------------------------------------- #
# building the application without starting it
# --------------------------------------------------------------------------- #


def _absent_config_path(repo_root: Path) -> Path:
    """A `KSHUI_CONFIG` value that is guaranteed not to resolve to a file."""
    path = repo_root / ".k-shui-release-reference" / "no-such-config.yaml"
    if path.exists():  # pragma: no cover — refuse to run rather than read it
        raise GenerationError(
            f"{path} exists; the generator needs this path to be absent so that no "
            "deployment configuration can be read"
        )
    return path


def isolate_environment(repo_root: Path = REPO_ROOT) -> list[str]:
    """Remove every configuration input from the process environment.

    Returns the names that were dropped, so callers (and tests) can see what the
    generator refused to honour.
    """
    dropped = sorted(
        name
        for name in list(os.environ)
        if name.startswith("KSHUI__") or name in {"KSHUI_BOOTSTRAP_SERVERS", "KSHUI_JWT_SECRET"}
    )
    for name in dropped:
        del os.environ[name]
    os.environ["KSHUI_CONFIG"] = str(_absent_config_path(repo_root))
    return dropped


def build_settings(repo_root: Path = REPO_ROOT):  # -> k_shui.config.Settings
    """Construct `Settings()` from in-code defaults, and prove that it is."""
    isolate_environment(repo_root)
    Settings = _import_settings(repo_root)

    if Settings._yaml_data:  # pragma: no cover — a previous load_settings() leaked
        raise GenerationError("Settings._yaml_data is populated; a configuration file was parsed")

    settings = Settings()

    # `load_settings()` is deliberately *not* used: it searches ./k-shui.yaml,
    # ~/.config/k-shui/config.yaml and /etc/k-shui/config.yaml, invents a
    # `default` cluster, and mints a JWT secret with os.urandom. All three would
    # be wrong here — the first two leak a deployment, the third is not
    # deterministic.
    if settings.configPath is not None:
        raise GenerationError(f"a configuration file was read: {settings.configPath}")
    if settings.clusters:
        raise GenerationError("a cluster was configured; the reference must describe defaults only")
    if settings.auth.jwtSecret is not None:
        raise GenerationError("a JWT secret was materialised; the reference must not carry one")
    leaked = sorted(name for name in os.environ if name.startswith("KSHUI__"))
    if leaked:
        raise GenerationError(f"KSHUI__ variables survived isolation: {', '.join(leaked)}")
    return settings


def build_app(settings=None, repo_root: Path = REPO_ROOT):  # -> fastapi.FastAPI
    """Construct the FastAPI app. `lifespan` is never entered."""
    settings = settings if settings is not None else build_settings(repo_root)
    create_app = _import_create_app(repo_root)
    app = create_app(settings)
    assert_no_lifespan(app, repo_root)
    return app


def assert_no_lifespan(app, repo_root: Path = REPO_ROOT) -> None:
    """Fail loudly if anything that only `lifespan` does has happened."""
    from k_shui.db import session as db_session

    if db_session.is_ready() or db_session.get_engine() is not None:
        raise GenerationError("a database engine exists; lifespan (or init_db) ran")
    if getattr(app.state, "samplers", None) is not None:
        raise GenerationError("a SamplerManager exists; lifespan ran")
    if getattr(app.state, "alert_engine", None) is not None:
        raise GenerationError("an alert engine exists; lifespan ran")
    if hasattr(app.state, "bus"):
        raise GenerationError("an event bus was attached; lifespan ran")
    if app.state.registry.ids():
        raise GenerationError("the cluster registry is not empty; a cluster would be contacted")
    for artefact in ("k-shui.db", "k-shui.db-journal"):
        if (repo_root / artefact).exists():
            raise GenerationError(f"{artefact} appeared in the repository root; lifespan ran")


def _import_settings(repo_root: Path):
    _ensure_backend_importable(repo_root)
    from k_shui.config import Settings

    return Settings


def _import_create_app(repo_root: Path):
    _ensure_backend_importable(repo_root)
    from k_shui.main import create_app

    return create_app


def _ensure_backend_importable(repo_root: Path) -> None:
    if sys.version_info[:2] < MIN_PYTHON:
        raise GenerationError(
            "k-shui needs Python {}.{}+ to import; this interpreter is {}.{}".format(
                *MIN_PYTHON, sys.version_info.major, sys.version_info.minor
            )
        )
    backend = str(repo_root / "backend")
    if backend not in sys.path:
        sys.path.insert(0, backend)


# --------------------------------------------------------------------------- #
# redaction
# --------------------------------------------------------------------------- #


def redact(value: Any, key: str | None = None) -> Any:
    """Replace secret-bearing *values*, keeping every key and the structure."""
    if key is not None and _is_secret(key) and value is not None:
        return REDACTED if not isinstance(value, (list, dict)) else _redact_container(value)
    if isinstance(value, dict):
        return {k: redact(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(item, key=None) for item in value]
    return value


def _redact_container(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: REDACTED for k in value}
    return [REDACTED for _ in value]


def _is_secret(key: str) -> bool:
    return key in SECRET_KEYS


def redact_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Redact `default`/`examples` recorded against secret-named properties.

    Today every such default is `null` (secrets have no in-code default), so
    this is a no-op on the current schema. It exists so that adding a field with
    a baked-in example credential cannot quietly publish it.
    """

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            out: dict[str, Any] = {}
            for key, value in node.items():
                if key == "properties" and isinstance(value, dict):
                    out[key] = {name: _redact_property(name, walk(sub)) for name, sub in value.items()}
                else:
                    out[key] = walk(value)
            return out
        if isinstance(node, list):
            return [walk(item) for item in node]
        return node

    return walk(schema)


def _redact_property(name: str, node: Any) -> Any:
    if not _is_secret(name) or not isinstance(node, dict):
        return node
    out = dict(node)
    for field in ("default", "examples", "const"):
        if out.get(field) is not None:
            out[field] = redact(out[field], key=name)
    return out


# --------------------------------------------------------------------------- #
# documents
# --------------------------------------------------------------------------- #


def render_openapi(app) -> dict[str, Any]:
    return app.openapi()


def render_configuration(settings, schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema": schema,
        "defaults": redact(settings.model_dump(mode="json")),
    }


def render_install(tag: str, version: str, prerelease: bool, repo_root: Path) -> dict[str, Any]:
    # A prerelease is reachable by exact version only: it never takes the npm
    # `latest` dist-tag and never moves the `latest` image tag. The image
    # reference always pins the version, for stable releases too — `latest` is a
    # moving target and a frozen document must not point at one.
    dist_tag = "next" if prerelease else "latest"
    image = f"{IMAGE_REPOSITORY}:{version}"
    return {
        "version": version,
        "tag": tag,
        "prerelease": prerelease,
        "artifacts": {
            "pypi": {
                "package": PYPI_PACKAGE,
                "command": f"uvx {PYPI_PACKAGE}@{version} serve",
            },
            "npm": {
                "package": NPM_PACKAGE,
                "distTag": dist_tag,
                "command": f"npx {NPM_PACKAGE}@{version}",
            },
            "image": {
                "reference": image,
                "command": f"docker pull {image}",
            },
            "helm": {
                "chart": HELM_CHART,
                "version": version,
                "command": f"helm install k-shui {HELM_CHART} --version {version}",
            },
        },
        "requirements": _requirements(repo_root),
    }


def _requirements(repo_root: Path) -> dict[str, str]:
    """Runtime requirements, read from the release commit rather than hard-coded."""
    python = _first_match(
        repo_root / "backend" / "pyproject.toml",
        r'^requires-python\s*=\s*"([^"]+)"',
        default=">=3.11",
    )
    node = ">=18"
    manifest = repo_root / "packages" / "npm" / "package.json"
    if manifest.is_file():
        node = json.loads(manifest.read_text(encoding="utf-8")).get("engines", {}).get("node", node)
    return {"python": python, "node": node}


def _first_match(path: Path, pattern: str, default: str) -> str:
    if not path.is_file():
        return default
    match = re.search(pattern, path.read_text(encoding="utf-8"), re.MULTILINE)
    return match.group(1) if match else default


def render_release_notes(version: str, tag: str, commit: str, repo_root: Path) -> str:
    """The `CHANGELOG.md` section for `version`, or an explicit stub."""
    changelog = repo_root / "CHANGELOG.md"
    section = (
        _changelog_section(changelog.read_text(encoding="utf-8"), version) if changelog.is_file() else None
    )
    if section:
        return section
    return (
        f"# k-shui {tag}\n"
        "\n"
        f"`CHANGELOG.md` carries no section for {version} at commit `{commit}`.\n"
        "\n"
        "The changelog is generated by release-please from the Conventional Commits\n"
        "that land on `main`, so a hand-cut tag can reach publication before its\n"
        "entry exists. The authoritative notes for this version are the GitHub\n"
        f"release: <https://github.com/{REPOSITORY}/releases/tag/{tag}>\n"
    )


def _changelog_section(text: str, version: str) -> str | None:
    """Extract `## [x.y.z]…` (or `## x.y.z`) up to the next level-2 heading."""
    escaped = re.escape(version)
    start = re.search(rf"^##\s+\[?v?{escaped}\]?(?![0-9A-Za-z.-])", text, re.MULTILINE)
    if not start:
        return None
    rest = text[start.start() :]
    following = re.search(r"^##\s", rest[1:], re.MULTILINE)
    body = rest if following is None else rest[: following.start() + 1]
    return body.replace("\r\n", "\n").rstrip("\n") + "\n"


# --------------------------------------------------------------------------- #
# configuration.md — rendered from the schema, never written by hand
# --------------------------------------------------------------------------- #


def render_configuration_markdown(schema: dict[str, Any], tag: str, commit: str) -> str:
    defs: dict[str, Any] = schema.get("$defs", {})
    top: dict[str, Any] = schema.get("properties", {})
    required = set(schema.get("required", []))

    lines: list[str] = [
        "# k-shui configuration reference",
        "",
        f"Generated from the `Settings` model at `{tag}` (`{commit}`) by",
        f"`{GENERATOR}`. Do not edit by hand — change `backend/k_shui/config.py`",
        "and regenerate.",
        "",
        "k-shui reads a YAML configuration file (`--config`, `KSHUI_CONFIG`, then",
        "`./k-shui.yaml`, `~/.config/k-shui/config.yaml`, `/etc/k-shui/config.yaml`).",
        "Every key can be overridden from the environment with the `KSHUI__` prefix",
        "and `__` between levels — `KSHUI__SERVER__PORT=9000` sets `server.port`.",
        "Environment variables win over the file, and the file wins over the",
        "defaults listed here.",
        "",
        "Values shown as `" + REDACTED + "` are secret-bearing and are never",
        "published in a generated reference.",
        "",
    ]

    blocks = [name for name, node in top.items() if _block_def_name(node, defs)]

    # Scalar top-level keys (today only `configPath`) are fully described by the
    # summary table; only the object blocks earn a section of their own.
    lines += [
        "## Top-level keys",
        "",
        "| Key | Type | Default | Description |",
        "| --- | --- | --- | --- |",
    ]
    for name, node in top.items():
        lines.append(_field_row(name, node, defs, name in required))
    lines.append("")

    emitted: set[str] = set()
    for name in blocks:
        def_name = _block_def_name(top[name], defs)
        assert def_name is not None
        emitted.add(def_name)
        lines += _object_section(f"## {name}", top[name], defs)

    referenced = _reachable(top, defs) - emitted
    if referenced:
        lines += ["## Referenced types", ""]
        for def_name in sorted(referenced):
            lines += _object_section(f"### {def_name}", {"$ref": f"#/$defs/{def_name}"}, defs)

    return "\n".join(lines).rstrip("\n") + "\n"


def _object_section(heading: str, node: dict[str, Any], defs: dict[str, Any]) -> list[str]:
    resolved = _resolve(node, defs)
    is_list = resolved.get("type") == "array"
    if is_list:
        resolved = _resolve(resolved.get("items", {}), defs)
    properties: dict[str, Any] = resolved.get("properties", {})
    required = set(resolved.get("required", []))

    out = [heading, ""]
    title = resolved.get("title")
    if title:
        out.append(f"A list of `{title}` objects." if is_list else f"`{title}` object.")
        out.append("")
    description = resolved.get("description")
    if description:
        out += [_one_line(description), ""]
    if not properties:
        out += ["No fields.", ""]
        return out
    out += ["| Field | Type | Default | Description |", "| --- | --- | --- | --- |"]
    for name, sub in properties.items():
        out.append(_field_row(name, sub, defs, name in required))
    out.append("")
    return out


def _field_row(name: str, node: dict[str, Any], defs: dict[str, Any], required: bool) -> str:
    type_label = _type_label(node, defs)
    if "default" in node:
        default = f"`{json.dumps(_display_default(name, node['default']), ensure_ascii=False)}`"
    elif required:
        default = "**required**"
    else:
        default = "—"
    resolved = _resolve(node, defs)
    description = node.get("description") or resolved.get("description") or ""
    return f"| `{name}` | {_cell(type_label)} | {_cell(default)} | {_cell(_one_line(description)) or '—'} |"


def _display_default(name: str, default: Any) -> Any:
    return redact(default, key=name)


def _type_label(node: dict[str, Any], defs: dict[str, Any]) -> str:
    ref = _ref_name(node)
    if ref:
        return f"[`{ref}`](#{_anchor(ref)})"
    if "anyOf" in node:
        parts = [_type_label(option, defs) for option in node["anyOf"]]
        return " \\| ".join(dict.fromkeys(parts))
    if "enum" in node:
        return " \\| ".join(json.dumps(value, ensure_ascii=False) for value in node["enum"])
    if "const" in node:
        return json.dumps(node["const"], ensure_ascii=False)
    kind = node.get("type")
    if kind == "array":
        return f"array of {_type_label(node.get('items', {}), defs)}"
    if kind == "object":
        return "object"
    if kind is None:
        return "any"
    return str(kind)


def _ref_name(node: dict[str, Any]) -> str | None:
    ref = node.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/$defs/"):
        return ref.split("/")[-1]
    return None


def _block_def_name(node: dict[str, Any], defs: dict[str, Any]) -> str | None:
    """The `$defs` name a top-level key documents, for objects and lists alike."""
    ref = _ref_name(node)
    if ref and ref in defs:
        return ref
    if node.get("type") == "array":
        item_ref = _ref_name(node.get("items", {}))
        if item_ref and item_ref in defs:
            return item_ref
    return None


def _reachable(properties: dict[str, Any], defs: dict[str, Any]) -> set[str]:
    """Every `$defs` entry reachable from the top-level properties."""
    seen: set[str] = set()
    pending = [node for node in properties.values()]
    while pending:
        node = pending.pop()
        if isinstance(node, dict):
            ref = _ref_name(node)
            if ref and ref not in seen:
                seen.add(ref)
                pending.append(defs.get(ref, {}))
            pending.extend(value for value in node.values() if isinstance(value, (dict, list)))
        elif isinstance(node, list):
            pending.extend(item for item in node if isinstance(item, (dict, list)))
    return seen


def _resolve(node: dict[str, Any], defs: dict[str, Any]) -> dict[str, Any]:
    ref = _ref_name(node)
    return defs.get(ref, {}) if ref else node


def _anchor(name: str) -> str:
    return re.sub(r"[^a-z0-9-]", "", name.lower().replace(" ", "-"))


def _one_line(text: str) -> str:
    return " ".join(text.split())


def _cell(text: str) -> str:
    return text.replace("\n", " ")


# --------------------------------------------------------------------------- #
# bundle assembly
# --------------------------------------------------------------------------- #


def json_bytes(payload: Any) -> bytes:
    return (json.dumps(payload, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def text_bytes(text: str) -> bytes:
    normalised = text.replace("\r\n", "\n").replace("\r", "\n")
    if not normalised.endswith("\n"):
        normalised += "\n"
    return normalised.encode("utf-8")


def build_reference(tag: str, commit: str, repo_root: Path = REPO_ROOT) -> dict[str, bytes]:
    """Every bundle member, as bytes, keyed by its path inside the bundle."""
    version, prerelease = parse_tag(tag)
    parse_commit(commit)

    settings = build_settings(repo_root)
    app = build_app(settings, repo_root)
    schema = redact_schema(type(settings).model_json_schema())

    files: dict[str, bytes] = {
        "openapi.json": json_bytes(render_openapi(app)),
        "configuration.json": json_bytes(render_configuration(settings, schema)),
        "configuration.md": text_bytes(render_configuration_markdown(schema, tag, commit)),
        "install.json": json_bytes(render_install(tag, version, prerelease, repo_root)),
        "release-notes.md": text_bytes(render_release_notes(version, tag, commit, repo_root)),
    }
    if set(files) != set(MEMBERS):  # pragma: no cover — guards MEMBERS drifting
        raise GenerationError(f"bundle members {sorted(files)} do not match {sorted(MEMBERS)}")

    files["manifest.json"] = json_bytes(
        {
            "schemaVersion": SCHEMA_VERSION,
            "generator": GENERATOR,
            "generatorVersion": GENERATOR_VERSION,
            "source": {
                "repository": REPOSITORY,
                "tag": tag,
                "commit": commit,
                "version": version,
                "prerelease": prerelease,
            },
            "files": [
                {"path": path, "sha256": sha256(files[path]), "bytes": len(files[path])}
                for path in sorted(files)
            ],
        }
    )
    return files


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def bundle_name(tag: str) -> str:
    return f"{BUNDLE_STEM}{tag}"


def write_bundle(files: dict[str, bytes], output_dir: Path, tag: str) -> tuple[Path, Path, Path]:
    """Write the bundle directory, its tarball and the tarball's sha256 file."""
    name = bundle_name(tag)
    directory = output_dir / name
    directory.mkdir(parents=True, exist_ok=True)
    for path in sorted(files):
        (directory / path).write_bytes(files[path])

    tarball = output_dir / f"{name}.tar.gz"
    tarball.write_bytes(tar_gz_bytes(files, name))

    checksum = output_dir / f"{name}.tar.gz.sha256"
    checksum.write_bytes(f"{sha256(tarball.read_bytes())}  {name}.tar.gz\n".encode())
    return directory, tarball, checksum


def tar_gz_bytes(files: dict[str, bytes], root: str) -> bytes:
    """A byte-for-byte reproducible gzip tarball.

    Everything that a tar normally records about *when* and *who* is pinned:
    member order is sorted, `mtime` is 0 on every member and in the gzip header,
    ownership is root:root with empty owner names, and the modes are fixed.
    """
    raw = io.BytesIO()
    # `filename=""` keeps the source path out of the gzip header; `mtime=0`
    # keeps the clock out of it.
    with (
        gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0) as gz,
        tarfile.open(fileobj=gz, mode="w", format=tarfile.PAX_FORMAT) as tar,
    ):
        tar.addfile(_member(root, tarfile.DIRTYPE, 0o755, 0))
        for path in sorted(files):
            payload = files[path]
            tar.addfile(
                _member(f"{root}/{path}", tarfile.REGTYPE, 0o644, len(payload)),
                io.BytesIO(payload),
            )
    return raw.getvalue()


def _member(name: str, kind: bytes, mode: int, size: int) -> tarfile.TarInfo:
    info = tarfile.TarInfo(name)
    info.type = kind
    info.mode = mode
    info.size = size
    info.mtime = 0
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    return info


def generate(tag: str, commit: str, output_dir: Path, repo_root: Path = REPO_ROOT) -> tuple[Path, Path, Path]:
    return write_bundle(build_reference(tag, commit, repo_root), output_dir, tag)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def _check_determinism(tag: str, commit: str, output_dir: Path, repo_root: Path) -> int:
    """Regenerate into a temporary directory and compare byte for byte."""
    name = bundle_name(tag)
    with tempfile.TemporaryDirectory(prefix="k-shui-reference-check-") as tmp:
        second = Path(tmp)
        generate(tag, commit, second, repo_root)
        differences: list[str] = []
        for relative in [
            f"{name}.tar.gz",
            f"{name}.tar.gz.sha256",
            *(f"{name}/{m}" for m in sorted(MEMBERS)),
            f"{name}/manifest.json",
        ]:
            a = (output_dir / relative).read_bytes()
            b = (second / relative).read_bytes()
            if a != b:
                differences.append(f"  {relative}: {sha256(a)} != {sha256(b)}")
    if differences:
        print("error: regeneration is not byte-identical:", file=sys.stderr)
        print("\n".join(differences), file=sys.stderr)
        return 1
    print(f"--check: {len(MEMBERS) + 3} artefacts regenerated byte-identically")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="generate_release_reference.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--tag", required=True, metavar="vX.Y.Z", help="release tag, e.g. v0.2.0")
    parser.add_argument("--commit", required=True, metavar="SHA", help="the 40-hex commit the tag points at")
    parser.add_argument(
        "--output-dir", required=True, metavar="DIR", type=Path, help="directory to write the bundle into"
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="regenerate into a temporary directory and fail unless every byte matches",
    )
    args = parser.parse_args(argv)

    try:
        directory, tarball, checksum = generate(args.tag, args.commit, args.output_dir)
    except GenerationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    digest = checksum.read_text(encoding="utf-8").split()[0]
    print(f"wrote {directory}/ ({len(MEMBERS) + 1} files)")
    print(f"wrote {tarball}")
    print(f"wrote {checksum}  sha256={digest}")

    if args.check:
        try:
            return _check_determinism(args.tag, args.commit, args.output_dir, REPO_ROOT)
        except GenerationError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
