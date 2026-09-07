"""Guided cluster onboarding: probe candidate connection details, then generate YAML.

k-shui's cluster inventory is deployment-managed — the running server never mutates its
own ``clusters`` list. Onboarding is therefore two steps that this module implements:

1. :func:`run_connection_test` probes every *provided* component independently, with a
   bounded per-component timeout, and reports whether a failure is a **connectivity**,
   **credentials**, **permissions** or **configuration** problem.
2. :func:`generate_config` turns the same input into a ``k-shui.yaml`` fragment the
   operator applies and restarts with. Every credential becomes a ``${ENV_VAR}``
   placeholder, so the generated snippet is safe to paste into a ticket or a repo.

Nothing in a response echoes a submitted secret: :func:`_redact` scrubs any secret value
that an upstream error message happened to quote, and URLs lose their userinfo.
"""

from __future__ import annotations

import asyncio
import re
import time
from collections.abc import Callable, Coroutine
from typing import Any
from urllib.parse import unquote, urlsplit, urlunsplit

import httpx
import yaml

from k_shui.api.schemas.connection import (
    ComponentResult,
    ConnectionTestRequest,
    ConnectionTestResponse,
    EndpointInput,
    EnvVarHint,
    GeneratedConfig,
    HttpAuthInput,
)
from k_shui.config import HttpAuth
from k_shui.core.logging import SENSITIVE_HINTS, get_logger
from k_shui.integrations.http import build_client

log = get_logger(__name__)

#: Extra head-room over the caller's timeout so a wedged client still yields a result
#: instead of hanging the request.
TIMEOUT_GRACE = 2.0

#: Which of the three questions ("network? credentials? permissions?") a status answers.
STATUS_CATEGORY: dict[str, str] = {
    "ok": "none",
    "unreachable": "connectivity",
    "auth_failed": "credentials",
    "permission_denied": "permissions",
    "invalid": "configuration",
}

COMPONENT_LABELS: dict[str, str] = {
    "kafka": "Kafka",
    "schemaRegistry": "Schema Registry",
    "connect": "Kafka Connect",
    "ksqldb": "ksqlDB",
    "flink": "Flink",
    "prometheus": "Prometheus",
}

HTTP_COMPONENTS = ("schemaRegistry", "connect", "ksqldb", "flink", "prometheus")

# --------------------------------------------------------------------------- error mapping
# librdkafka reports the same underlying failure in several dialects depending on the
# broker, the security protocol and the client build. Markers are matched lowercase and
# in this order: an authorization failure is more specific than an authentication one,
# which in turn is more specific than "all brokers are down" (a SASL rejection usually
# reports both).
_PERMISSION_MARKERS = (
    "authorization_failed",
    "_authorization",
    "not authorized",
    "authorization failed",
    "topic_authorization",
    "cluster_authorization",
    "group_authorization",
)
_CREDENTIAL_MARKERS = (
    "authentication_failed",
    "_authentication",
    "authentication failed",
    "sasl authentication",
    "unsupported_sasl_mechanism",
    "illegal_sasl_state",
    "invalid credentials",
    "bad credentials",
)
_INVALID_MARKERS = (
    "no such configuration property",
    "invalid value",
    "_invalid_arg",
    "configuration property",
    "ssl handshake",
    "certificate verify failed",
    "unable to get local issuer",
)
_UNREACHABLE_MARKERS = (
    "_transport",
    "_all_brokers_down",
    "_timed_out",
    "_resolve",
    "broker_not_available",
    "connection refused",
    "name or service not known",
    "no address associated",
    "timed out",
)

# Config keys whose values are credentials and must become env placeholders. ``.location``
# keys are filesystem paths (keystore/CA files), not secrets, so they stay literal.
_CREDENTIAL_HINTS = (*SENSITIVE_HINTS, "username", "user")


def is_credential_key(key: str) -> bool:
    """True when a librdkafka property name holds a credential rather than a setting."""
    lowered = key.lower()
    if lowered.endswith(".location"):
        return False
    return any(hint in lowered for hint in _CREDENTIAL_HINTS)


def classify_kafka_error(text: str) -> str:
    """Map a librdkafka error string onto a component status."""
    lowered = text.lower()
    for markers, status in (
        (_PERMISSION_MARKERS, "permission_denied"),
        (_CREDENTIAL_MARKERS, "auth_failed"),
        (_INVALID_MARKERS, "invalid"),
        (_UNREACHABLE_MARKERS, "unreachable"),
    ):
        if any(marker in lowered for marker in markers):
            return status
    return "unreachable"


def _endpoints(request: ConnectionTestRequest) -> list[EndpointInput]:
    return [e for e in (getattr(request, name) for name in HTTP_COMPONENTS) if e is not None]


def _secret_values(request: ConnectionTestRequest) -> list[str]:
    """Every submitted secret, so upstream error text quoting one can be scrubbed."""
    values: list[str] = [v for k, v in (request.properties or {}).items() if is_credential_key(k) and v]
    for endpoint in _endpoints(request):
        auth = endpoint.auth
        if auth is not None:
            values.extend(v for v in (auth.username, auth.password, auth.bearerToken) if v)
        try:
            parts = urlsplit(endpoint.url)
            for value in (parts.username, parts.password):
                if value:
                    values.extend((value, unquote(value)))
        except ValueError:
            pass
    return sorted(set(values), key=len, reverse=True)


def _redact(text: str, secrets: list[str]) -> str:
    if not secrets:
        return text
    return re.sub("|".join(re.escape(secret) for secret in secrets), "***", text)


def redact_url(url: str) -> str:
    """Drop ``user:pass@`` userinfo from a URL so it is safe to return or write to YAML."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return url
    if not parts.hostname or "@" not in (parts.netloc or ""):
        return url
    netloc = parts.netloc.rsplit("@", 1)[1]
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def _result(
    component: str,
    target: str,
    status: str,
    detail: str,
    started: float,
    metadata: dict[str, Any] | None = None,
) -> ComponentResult:
    return ComponentResult(
        component=component,  # type: ignore[arg-type]
        label=COMPONENT_LABELS.get(component, component),
        target=target,
        status=status,  # type: ignore[arg-type]
        category=STATUS_CATEGORY[status],  # type: ignore[arg-type]
        latencyMs=round((time.perf_counter() - started) * 1000, 1),
        detail=detail,
        metadata={k: v for k, v in (metadata or {}).items() if v is not None},
    )


# --------------------------------------------------------------------------- kafka probe
def _kafka_metadata(conf: dict[str, Any], timeout: float) -> dict[str, Any]:
    """Blocking librdkafka metadata fetch — the one call that needs a real broker."""
    from confluent_kafka.admin import AdminClient

    client = AdminClient(conf)
    md = client.list_topics(timeout=timeout)
    brokers = sorted(f"{b.host}:{b.port}" for b in md.brokers.values())
    return {
        "clusterId": md.cluster_id,
        "brokerCount": len(md.brokers),
        "controllerId": md.controller_id,
        "topicCount": len(md.topics),
        "brokers": brokers[:16],
    }


def kafka_client_config(request: ConnectionTestRequest, timeout: float) -> dict[str, Any]:
    """librdkafka config for the probe: bootstrap servers + the candidate properties."""
    conf: dict[str, Any] = {
        "bootstrap.servers": request.bootstrapServers,
        "socket.timeout.ms": int(timeout * 1000),
    }
    conf.update({k: v for k, v in (request.properties or {}).items() if v not in (None, "")})
    return conf


_KAFKA_HINTS = {
    "auth_failed": (
        "The broker rejected the credentials. Check security.protocol, sasl.mechanism, "
        "sasl.username and sasl.password."
    ),
    "permission_denied": (
        "Authenticated, but this principal may not describe the cluster. Grant it DESCRIBE "
        "on the cluster and on the topics you need."
    ),
    "invalid": (
        "The client configuration was rejected. Check property names and any TLS keystore/truststore files."
    ),
    "unreachable": (
        "No broker answered. Check the bootstrap address and port, network access, and the "
        "advertised listeners the brokers hand back."
    ),
}


async def probe_kafka(request: ConnectionTestRequest, secrets: list[str]) -> ComponentResult:
    """Fetch cluster metadata with a bounded timeout; never raises."""
    timeout = request.timeoutSeconds
    conf = kafka_client_config(request, timeout)
    target = request.bootstrapServers
    started = time.perf_counter()
    try:
        metadata = await asyncio.wait_for(
            asyncio.to_thread(_kafka_metadata, conf, timeout), timeout=timeout + TIMEOUT_GRACE
        )
    except TimeoutError:
        return _result(
            "kafka",
            target,
            "unreachable",
            f"{_KAFKA_HINTS['unreachable']} (no metadata response within {timeout:g}s)",
            started,
        )
    except Exception as exc:  # a client failure is a test result, not a 500
        status = classify_kafka_error(str(exc))
        text = _redact(str(exc), secrets)[:400]
        return _result("kafka", target, status, f"{_KAFKA_HINTS[status]} ({text})", started)

    cluster_id = metadata.get("clusterId")
    detail = f"Connected to {metadata.get('brokerCount', 0)} broker(s)."
    if cluster_id:
        detail = f"{detail[:-1]} — cluster id {cluster_id}."
    return _result("kafka", target, "ok", detail, started, metadata=metadata)


# --------------------------------------------------------------------------- http probes
def _sr_metadata(body: Any) -> dict[str, Any]:
    return {"subjectCount": len(body)} if isinstance(body, list) else {}


def _connect_metadata(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        return {}
    return {"version": body.get("version"), "kafkaClusterId": body.get("kafka_cluster_id")}


def _ksql_metadata(body: Any) -> dict[str, Any]:
    info = body.get("KsqlServerInfo") if isinstance(body, dict) else None
    if not isinstance(info, dict):
        return {}
    return {"version": info.get("version"), "ksqlServiceId": info.get("ksqlServiceId")}


def _flink_metadata(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        return {}
    return {
        "version": body.get("flink-version"),
        "taskmanagers": body.get("taskmanagers"),
        "slotsTotal": body.get("slots-total"),
    }


def _prometheus_metadata(body: Any) -> dict[str, Any]:
    data = body.get("data") if isinstance(body, dict) else None
    return {"version": data.get("version")} if isinstance(data, dict) else {}


#: component → (candidate paths, tried in order until one is not a 404; metadata extractor)
HTTP_PROBES: dict[str, tuple[tuple[str, ...], Callable[[Any], dict[str, Any]]]] = {
    "schemaRegistry": (("/subjects",), _sr_metadata),
    "connect": (("/",), _connect_metadata),
    "ksqldb": (("/info",), _ksql_metadata),
    "flink": (("/overview",), _flink_metadata),
    "prometheus": (("/api/v1/status/buildinfo", "/api/v1/query?query=1"), _prometheus_metadata),
}


def _to_http_auth(auth: HttpAuthInput | None) -> HttpAuth | None:
    if auth is None:
        return None
    return HttpAuth(username=auth.username, password=auth.password, bearerToken=auth.bearerToken)


def _endpoint_auth(endpoint: EndpointInput) -> HttpAuthInput | None:
    if endpoint.auth is not None:
        return endpoint.auth
    try:
        parts = urlsplit(endpoint.url)
    except ValueError:
        return None
    if parts.username is None:
        return None
    return HttpAuthInput(username=unquote(parts.username), password=unquote(parts.password or ""))


def http_status_for(code: int) -> str:
    """Map an upstream HTTP status onto a component status."""
    if code in (401, 407):
        return "auth_failed"
    if code == 403:
        return "permission_denied"
    if code >= 500:
        return "unreachable"
    return "invalid"


def _http_detail(label: str, status: str, response: httpx.Response, secrets: list[str]) -> str:
    code = response.status_code
    body = _redact((response.text or "").strip(), secrets)[:200]
    hints = {
        "auth_failed": (
            f"{label} rejected the credentials (HTTP {code}). Check the username, password or token."
        ),
        "permission_denied": (
            f"{label} accepted the credentials but denied the request (HTTP {code}). "
            "The account needs read access to this API."
        ),
        "unreachable": f"{label} returned a server error (HTTP {code}).",
        "invalid": (
            f"{label} answered HTTP {code} at {response.request.url.path}. Check the URL — it must "
            "point at the API root."
        ),
    }
    return f"{hints[status]} {body}".strip()


async def probe_http(
    component: str, endpoint: EndpointInput, timeout_seconds: float, secrets: list[str]
) -> ComponentResult:
    """GET a cheap health/metadata path on an HTTP integration; never raises."""
    label = COMPONENT_LABELS[component]
    target = redact_url(endpoint.url)
    started = time.perf_counter()
    paths, extract = HTTP_PROBES[component]

    if not urlsplit(endpoint.url).scheme.startswith("http"):
        return _result(component, target, "invalid", f"'{target}' is not an http(s) URL.", started)

    auth = _to_http_auth(_endpoint_auth(endpoint))
    # Keep userinfo out of HTTPX request URLs (and its standard request logs).
    client = build_client(
        target,
        auth,
        timeout=httpx.Timeout(
            connect=timeout_seconds, read=timeout_seconds, write=timeout_seconds, pool=timeout_seconds
        ),
    )
    try:
        response: httpx.Response | None = None
        for path in paths:
            try:
                response = await asyncio.wait_for(client.get(path), timeout=timeout_seconds + TIMEOUT_GRACE)
            except TimeoutError:
                return _result(
                    component,
                    target,
                    "unreachable",
                    f"{label} did not answer within {timeout_seconds:g}s at {target}.",
                    started,
                )
            except httpx.TransportError as exc:
                return _result(
                    component,
                    target,
                    "unreachable",
                    f"{label} is unreachable at {target}: {_redact(str(exc), secrets)[:200]}",
                    started,
                )
            except Exception as exc:  # malformed URL and friends
                return _result(
                    component,
                    target,
                    "invalid",
                    f"{label} could not be called at {target}: {_redact(str(exc), secrets)[:200]}",
                    started,
                )
            if response.status_code != 404:
                break

        if response is None:  # pragma: no cover - HTTP_PROBES never has an empty path list
            return _result(component, target, "invalid", f"No probe path for {label}.", started)
        if not response.is_success:
            status = http_status_for(response.status_code)
            return _result(component, target, status, _http_detail(label, status, response, secrets), started)
        try:
            body = response.json()
        except ValueError:
            return _result(
                component,
                target,
                "invalid",
                f"{label} answered {response.status_code} but the body was not JSON. Check that the "
                "URL points at the API root.",
                started,
            )
        return _result(component, target, "ok", f"{label} responded.", started, metadata=extract(body))
    finally:
        await client.aclose()


# --------------------------------------------------------------------------- orchestration
async def run_connection_test(request: ConnectionTestRequest) -> ConnectionTestResponse:
    """Probe every provided component concurrently, then generate the matching config."""
    secrets = _secret_values(request)
    started = time.perf_counter()

    jobs: list[tuple[str, Coroutine[Any, Any, ComponentResult]]] = [("kafka", probe_kafka(request, secrets))]
    for component in HTTP_COMPONENTS:
        endpoint: EndpointInput | None = getattr(request, component)
        if endpoint is not None:
            jobs.append((component, probe_http(component, endpoint, request.timeoutSeconds, secrets)))

    outcomes = await asyncio.gather(*(coro for _, coro in jobs), return_exceptions=True)
    components: list[ComponentResult] = []
    for (component, _), outcome in zip(jobs, outcomes, strict=True):
        if isinstance(outcome, ComponentResult):
            components.append(outcome)
            continue
        # A probe is not supposed to raise; if one does, report it instead of 500-ing.
        log.warning("connection_test.probe_failed", component=component, errorType=type(outcome).__name__)
        components.append(
            _result(
                component,
                "unknown",
                "invalid",
                f"Probe failed unexpectedly: {_redact(str(outcome), secrets)[:200]}",
                started,
            )
        )

    return ConnectionTestResponse(
        ok=all(c.status == "ok" for c in components),
        clusterId=request.clusterId,
        durationMs=round((time.perf_counter() - started) * 1000, 1),
        components=components,
        config=generate_config(request),
    )


# --------------------------------------------------------------------------- yaml generation
_HEADER = """\
# Generated by k-shui. Merge this into the `clusters:` list of your k-shui.yaml and
# restart the server — the cluster inventory is read once at startup.
# ${VAR} placeholders are expanded from the process environment, so credentials never
# land in the file. ${VAR:-default} works too.
"""


def env_var_name(cluster_id: str, *parts: str) -> str:
    """``KSHUI_<CLUSTER>_<PART>…`` upper-snake env var name for a credential."""
    raw = "_".join(("KSHUI", cluster_id, *parts))
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", raw).strip("_").upper()
    return re.sub(r"_+", "_", cleaned)


def _placeholder(name: str) -> str:
    return "${" + name + "}"


def _auth_block(
    cluster_id: str, component: str, prefix: str, auth: HttpAuthInput | None, hints: list[EnvVarHint]
) -> dict[str, Any] | None:
    if auth is None:
        return None
    label = COMPONENT_LABELS[component]
    block: dict[str, Any] = {}
    for field, suffix, what in (
        ("bearerToken", "token", "Bearer token"),
        ("username", "username", "Username"),
        ("password", "password", "Password"),
    ):
        if not getattr(auth, field):
            continue
        name = env_var_name(cluster_id, prefix, suffix)
        block[field] = _placeholder(name)
        hints.append(
            EnvVarHint(
                name=name,
                component=component,  # type: ignore[arg-type]
                description=f"{what} for the {label} API.",
            )
        )
    return block or None


def generate_config(request: ConnectionTestRequest) -> GeneratedConfig:
    """Build a ``k-shui.yaml`` cluster fragment with credentials as env placeholders."""
    cluster_id = request.clusterId
    hints: list[EnvVarHint] = []

    properties: dict[str, Any] = {}
    for key, value in (request.properties or {}).items():
        if value in (None, ""):
            continue
        if is_credential_key(key):
            name = env_var_name(cluster_id, key)
            properties[key] = _placeholder(name)
            hints.append(
                EnvVarHint(name=name, component="kafka", description=f"Kafka client property {key}.")
            )
        else:
            properties[key] = value

    cluster: dict[str, Any] = {
        "id": cluster_id,
        "name": request.clusterName or cluster_id,
        "bootstrapServers": request.bootstrapServers,
    }
    if properties:
        cluster["properties"] = properties

    registry = request.schemaRegistry
    if registry is not None:
        block: dict[str, Any] = {"url": redact_url(registry.url), "type": registry.type}
        auth = _auth_block(cluster_id, "schemaRegistry", "schema_registry", _endpoint_auth(registry), hints)
        if auth:
            block["auth"] = auth
        cluster["schemaRegistry"] = block

    for component in ("connect", "ksqldb"):
        endpoint: EndpointInput | None = getattr(request, component)
        if endpoint is None:
            continue
        entry: dict[str, Any] = {"name": endpoint.name or component, "url": redact_url(endpoint.url)}
        auth = _auth_block(cluster_id, component, component, _endpoint_auth(endpoint), hints)
        if auth:
            entry["auth"] = auth
        cluster[component] = [entry]

    flink = request.flink
    if flink is not None:
        entry = {"name": flink.name or "flink", "url": redact_url(flink.url)}
        if flink.sqlGatewayUrl:
            entry["sqlGatewayUrl"] = redact_url(flink.sqlGatewayUrl)
        auth = _auth_block(cluster_id, "flink", "flink", _endpoint_auth(flink), hints)
        if auth:
            entry["auth"] = auth
        cluster["flink"] = [entry]

    prometheus = request.prometheus
    if prometheus is not None:
        block = {"url": redact_url(prometheus.url)}
        if prometheus.labels:
            block["labels"] = dict(prometheus.labels)
        auth = _auth_block(cluster_id, "prometheus", "prometheus", _endpoint_auth(prometheus), hints)
        if auth:
            block["auth"] = auth
        cluster["prometheus"] = block
        cluster["metricsMode"] = "prometheus"

    body = yaml.safe_dump({"clusters": [cluster]}, sort_keys=False, default_flow_style=False, width=100)
    return GeneratedConfig(yaml=_HEADER + body, envVars=hints)


__all__ = [
    "COMPONENT_LABELS",
    "HTTP_COMPONENTS",
    "STATUS_CATEGORY",
    "classify_kafka_error",
    "env_var_name",
    "generate_config",
    "http_status_for",
    "is_credential_key",
    "probe_http",
    "probe_kafka",
    "redact_url",
    "run_connection_test",
]
