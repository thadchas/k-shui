"""Config loading: YAML, ${VAR} expansion, env overrides and defaults."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from k_shui.config import find_config_path, load_settings

YAML = """
server:
  port: 9111
  basePath: /kshui
auth:
  type: basic
  users:
    - username: admin
      password: ${TEST_ADMIN_PW}
      role: admin
database:
  url: ${TEST_DB_URL:-sqlite+aiosqlite:///./fallback.db}
clusters:
  - id: alpha
    bootstrapServers: ${TEST_BOOTSTRAP:-broker:9092}
    prometheus:
      url: http://prom:9090
  - id: beta
    name: Beta
    bootstrapServers: beta:9092
"""


@pytest.fixture
def config_file(tmp_path: Path) -> Path:
    path = tmp_path / "k-shui.yaml"
    path.write_text(YAML)
    return path


def test_loads_yaml_and_expands_env(config_file: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_ADMIN_PW", "s3cret")
    monkeypatch.delenv("TEST_DB_URL", raising=False)
    monkeypatch.delenv("TEST_BOOTSTRAP", raising=False)

    settings = load_settings(config_file)

    assert settings.server.port == 9111
    assert settings.server.basePath == "/kshui"
    assert settings.auth.type == "basic"
    assert settings.auth.users[0].password == "s3cret"
    assert settings.database.url == "sqlite+aiosqlite:///./fallback.db"
    assert [c.id for c in settings.clusters] == ["alpha", "beta"]
    assert settings.cluster("alpha").bootstrapServers == "broker:9092"
    assert settings.configPath == str(config_file)


def test_env_default_is_overridden_by_real_env(config_file: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_ADMIN_PW", "x")
    monkeypatch.setenv("TEST_BOOTSTRAP", "real:19092")
    settings = load_settings(config_file)
    assert settings.cluster("alpha").bootstrapServers == "real:19092"


def test_env_overrides_yaml_section(config_file: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_ADMIN_PW", "x")
    monkeypatch.setenv("KSHUI__SERVER__PORT", "9999")
    settings = load_settings(config_file)
    assert settings.server.port == 9999


def test_cluster_defaults_and_features(config_file: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_ADMIN_PW", "x")
    settings = load_settings(config_file)
    alpha = settings.cluster("alpha")
    assert alpha.name == "alpha"  # defaults to the id
    assert alpha.metricsMode == "prometheus"  # flipped because prometheus is configured
    assert alpha.features == {
        "schemaRegistry": False,
        "connect": False,
        "ksqldb": False,
        "flink": False,
        "prometheus": True,
        "lineage": False,
    }
    assert settings.cluster("beta").metricsMode == "sampled"


def test_no_config_falls_back_to_bootstrap_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("KSHUI_CONFIG", raising=False)
    monkeypatch.setenv("KSHUI_BOOTSTRAP_SERVERS", "solo:9092")
    settings = load_settings(None)
    assert settings.configPath is None
    assert len(settings.clusters) == 1
    assert settings.clusters[0].id == "default"
    assert settings.clusters[0].bootstrapServers == "solo:9092"
    assert settings.auth.jwtSecret  # generated


def test_find_config_path_prefers_explicit(config_file: Path) -> None:
    assert find_config_path(config_file) == config_file
    assert find_config_path(config_file.parent / "missing.yaml") != config_file.parent / "missing.yaml"


def test_kshui_config_env_is_honoured(config_file: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_ADMIN_PW", "x")
    monkeypatch.setenv("KSHUI_CONFIG", str(config_file))
    monkeypatch.chdir(config_file.parent.parent)
    settings = load_settings(None)
    assert settings.server.port == 9111
    assert os.environ["KSHUI_CONFIG"] == str(config_file)
