"""Guided cluster onboarding: connection-test request/response models.

Nothing here ever carries a secret *back* to the client: the request accepts candidate
credentials, every response field is either a redacted target, a status, or a generated
YAML snippet in which credentials are ``${ENV_VAR}`` placeholders.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from k_shui.api.schemas.common import Model

ComponentName = Literal["kafka", "schemaRegistry", "connect", "ksqldb", "flink", "prometheus"]
ComponentStatus = Literal["ok", "unreachable", "auth_failed", "permission_denied", "invalid"]
FailureCategory = Literal["none", "connectivity", "credentials", "permissions", "configuration"]

CLUSTER_ID_PATTERN = r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$"


class HttpAuthInput(Model):
    """Optional credentials for an HTTP integration (never echoed back)."""

    username: str | None = None
    password: str | None = None
    bearerToken: str | None = None


class EndpointInput(Model):
    name: str | None = None
    url: str
    auth: HttpAuthInput | None = None


class SchemaRegistryInput(EndpointInput):
    type: Literal["confluent", "apicurio", "karapace"] = "confluent"


class FlinkInput(EndpointInput):
    sqlGatewayUrl: str | None = None


class PrometheusInput(EndpointInput):
    labels: dict[str, str] = Field(default_factory=dict)


class ConnectionTestRequest(Model):
    """Candidate connection details for a cluster that is not configured yet."""

    clusterId: str = Field(default="local", pattern=CLUSTER_ID_PATTERN, max_length=128)
    clusterName: str | None = Field(default=None, max_length=256)
    bootstrapServers: str = Field(min_length=1, max_length=2048)
    properties: dict[str, str] = Field(default_factory=dict)
    schemaRegistry: SchemaRegistryInput | None = None
    connect: EndpointInput | None = None
    ksqldb: EndpointInput | None = None
    flink: FlinkInput | None = None
    prometheus: PrometheusInput | None = None
    timeoutSeconds: float = Field(default=5.0, ge=1.0, le=15.0)


class ComponentResult(Model):
    component: ComponentName
    label: str
    #: The address that was probed, with any embedded credentials removed.
    target: str
    status: ComponentStatus
    #: What kind of problem this is — the answer to "is it the network, the
    #: credentials, or the permissions?". ``none`` when the component answered.
    category: FailureCategory
    latencyMs: float | None = None
    detail: str = ""
    #: Cheap discovered facts (broker count, cluster id, version …).
    metadata: dict[str, Any] = Field(default_factory=dict)


class EnvVarHint(Model):
    name: str
    component: ComponentName
    description: str


class GeneratedConfig(Model):
    """A ready-to-apply ``k-shui.yaml`` fragment plus the env vars it expects."""

    yaml: str
    envVars: list[EnvVarHint] = Field(default_factory=list)


class ConnectionTestResponse(Model):
    ok: bool
    clusterId: str
    durationMs: float
    components: list[ComponentResult] = Field(default_factory=list)
    config: GeneratedConfig


__all__ = [
    "ComponentName",
    "ComponentResult",
    "ComponentStatus",
    "ConnectionTestRequest",
    "ConnectionTestResponse",
    "EndpointInput",
    "EnvVarHint",
    "FailureCategory",
    "FlinkInput",
    "GeneratedConfig",
    "HttpAuthInput",
    "PrometheusInput",
    "SchemaRegistryInput",
]
