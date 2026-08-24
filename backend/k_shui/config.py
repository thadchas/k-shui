"""Configuration models. YAML file + environment overrides (KSHUI__SECTION__KEY).

This is the single source of truth for the config schema described in ARCHITECTURE.md.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, ClassVar, Literal

import yaml
from pydantic import BaseModel, Field, model_validator
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict


class BasicAuthUser(BaseModel):
    username: str
    password: str  # argon2 hash or plaintext (dev)
    role: Literal["admin", "editor", "viewer"] = "viewer"
    clusters: list[str] | None = None  # None = all clusters


class OIDCConfig(BaseModel):
    issuer: str
    clientId: str
    clientSecret: str
    scopes: list[str] = ["openid", "profile", "email"]
    rolesClaim: str = "roles"
    adminRoles: list[str] = ["admin"]
    editorRoles: list[str] = ["editor"]
    defaultRole: Literal["admin", "editor", "viewer", "none"] = "viewer"


class AuthConfig(BaseModel):
    type: Literal["none", "basic", "oidc"] = "none"
    users: list[BasicAuthUser] = []
    oidc: OIDCConfig | None = None
    jwtSecret: str | None = None  # generated at startup if missing (not persistent!)
    sessionHours: int = 12


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8090
    basePath: str = "/"
    cors: list[str] = []
    readOnly: bool = False


class DatabaseConfig(BaseModel):
    url: str = "sqlite+aiosqlite:///./k-shui.db"


class TelemetryConfig(BaseModel):
    metrics: bool = True
    otlpEndpoint: str | None = None
    logFormat: Literal["json", "console"] = "console"
    logLevel: str = "INFO"


class AlertsConfig(BaseModel):
    evaluationIntervalSeconds: int = 30
    historyRetentionDays: int = 30
    smtp: dict[str, Any] | None = None  # host, port, username, password, from, tls


class HttpAuth(BaseModel):
    username: str | None = None
    password: str | None = None
    bearerToken: str | None = None


class SchemaRegistryConfig(BaseModel):
    url: str
    type: Literal["confluent", "apicurio", "karapace"] = "confluent"
    auth: HttpAuth | None = None
    keySubjectNameStrategy: Literal["topic", "record", "topicRecord"] = "topic"


class ConnectClusterConfig(BaseModel):
    name: str
    url: str
    auth: HttpAuth | None = None


class KsqlConfig(BaseModel):
    name: str
    url: str
    auth: HttpAuth | None = None


class FlinkConfig(BaseModel):
    name: str
    url: str
    sqlGatewayUrl: str | None = None
    auth: HttpAuth | None = None


class PrometheusConfig(BaseModel):
    url: str
    labels: dict[str, str] = {}
    auth: HttpAuth | None = None


class LineageConfig(BaseModel):
    type: Literal["marquez", "none"] = "marquez"
    url: str | None = None
    namespaces: list[str] = []
    auth: HttpAuth | None = None


class ClusterConfig(BaseModel):
    id: str
    name: str | None = None
    bootstrapServers: str
    properties: dict[str, Any] = {}  # raw librdkafka properties
    readOnly: bool = False
    schemaRegistry: SchemaRegistryConfig | None = None
    connect: list[ConnectClusterConfig] = []
    ksqldb: list[KsqlConfig] = []
    flink: list[FlinkConfig] = []
    prometheus: PrometheusConfig | None = None
    lineage: LineageConfig | None = None
    metricsMode: Literal["prometheus", "sampled"] = "sampled"
    pollIntervalSeconds: int = 15

    @model_validator(mode="after")
    def _defaults(self) -> ClusterConfig:
        if not self.name:
            self.name = self.id
        if self.prometheus and self.metricsMode == "sampled":
            self.metricsMode = "prometheus"
        return self

    @property
    def features(self) -> dict[str, bool]:
        return {
            "schemaRegistry": self.schemaRegistry is not None,
            "connect": bool(self.connect),
            "ksqldb": bool(self.ksqldb),
            "flink": bool(self.flink),
            "prometheus": self.prometheus is not None,
            "lineage": self.lineage is not None and self.lineage.type != "none",
        }


class YamlSource(PydanticBaseSettingsSource):
    """Feeds parsed YAML into pydantic-settings at a lower priority than the environment."""

    def __init__(self, settings_cls: type[BaseSettings], data: dict[str, Any] | None = None) -> None:
        super().__init__(settings_cls)
        self._data = data or {}

    def get_field_value(self, field: Any, field_name: str) -> tuple[Any, str, bool]:  # pragma: no cover
        return self._data.get(field_name), field_name, False

    def __call__(self) -> dict[str, Any]:
        return dict(self._data)


class Settings(BaseSettings):
    """Effective configuration. Precedence: environment > YAML file > defaults."""

    model_config = SettingsConfigDict(env_prefix="KSHUI__", env_nested_delimiter="__", extra="ignore")

    _yaml_data: ClassVar[dict[str, Any]] = {}

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            env_settings,
            dotenv_settings,
            YamlSource(settings_cls, cls._yaml_data),
            file_secret_settings,
        )

    server: ServerConfig = ServerConfig()
    auth: AuthConfig = AuthConfig()
    database: DatabaseConfig = DatabaseConfig()
    telemetry: TelemetryConfig = TelemetryConfig()
    alerts: AlertsConfig = AlertsConfig()
    clusters: list[ClusterConfig] = Field(default_factory=list)
    configPath: str | None = None

    def cluster(self, cluster_id: str) -> ClusterConfig | None:
        return next((c for c in self.clusters if c.id == cluster_id), None)


CONFIG_SEARCH_PATHS = [
    "./k-shui.yaml",
    "./k-shui.yml",
    "~/.config/k-shui/config.yaml",
    "/etc/k-shui/config.yaml",
]


def find_config_path(explicit: str | os.PathLike[str] | None = None) -> Path | None:
    candidates: list[str] = []
    if explicit:
        candidates.append(str(explicit))
    if os.environ.get("KSHUI_CONFIG"):
        candidates.append(os.environ["KSHUI_CONFIG"])
    candidates.extend(CONFIG_SEARCH_PATHS)
    for c in candidates:
        p = Path(c).expanduser()
        if p.is_file():
            return p
    return None


def _expand_env(obj: Any) -> Any:
    """Expand ${VAR} / ${VAR:-default} inside YAML string values."""
    if isinstance(obj, dict):
        return {k: _expand_env(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_expand_env(v) for v in obj]
    if isinstance(obj, str) and "${" in obj:
        import re

        def repl(m: re.Match[str]) -> str:
            name, _, default = m.group(1).partition(":-")
            return os.environ.get(name, default)

        return re.sub(r"\$\{([^}]+)\}", repl, obj)
    return obj


def load_settings(config_path: str | os.PathLike[str] | None = None) -> Settings:
    path = find_config_path(config_path)
    data: dict[str, Any] = {}
    if path:
        with path.open() as fh:
            data = _expand_env(yaml.safe_load(fh) or {})
    Settings._yaml_data = data
    try:
        settings = Settings()
    finally:
        Settings._yaml_data = {}
    settings.configPath = str(path) if path else None
    if not settings.clusters:
        bootstrap = os.environ.get("KSHUI_BOOTSTRAP_SERVERS", "localhost:9092")
        settings.clusters = [ClusterConfig(id="default", name="default", bootstrapServers=bootstrap)]
    if not settings.auth.jwtSecret:
        settings.auth.jwtSecret = os.environ.get("KSHUI_JWT_SECRET") or os.urandom(32).hex()
    return settings
