"""Allowlisted, bounded metadata tools running under a refreshed human identity.

No message reader, arbitrary URL, SQL, log fetch, or shell tool is exposed. Returned
resource text is evidence, never instructions; free-form errors are deliberately omitted.
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

from fastapi import Request
from sqlalchemy import select

from k_shui.core.auth import Principal, Unauthorized
from k_shui.core.errors import BadRequest, Forbidden, NotFound, ReadOnly
from k_shui.core.registry import ClusterContext
from k_shui.db import session as db_session
from k_shui.db.models import User
from k_shui.kafka.admin import KafkaAdmin

MAX_RECORDS = 100
MAX_BYTES = 24_000
SAFE_CONFIGS = frozenset(
    {
        "retention.ms",
        "retention.bytes",
        "cleanup.policy",
        "segment.bytes",
        "segment.ms",
        "min.insync.replicas",
        "max.message.bytes",
        "compression.type",
        "delete.retention.ms",
        "min.compaction.lag.ms",
        "max.compaction.lag.ms",
        "message.timestamp.type",
    }
)
SENSITIVE = re.compile(r"password|secret|token|credential|authorization|jaas|private.?key|api.?key", re.I)
OMITTED = frozenset(
    {
        "payload",
        "messages",
        "headers",
        "keyRaw",
        "valueRaw",
        "trace",
        "exception",
        "error",
        "description",
        "schema",
        "query",
        "sql",
        "config",
        "details",
        "meta",
    }
)


def bounded_data(value: Any, *, budget: list[int] | None = None, depth: int = 0) -> Any:
    """Defense in depth for structured allowlisted metadata; omit free-form secret carriers."""
    budget = budget if budget is not None else [MAX_BYTES]
    if budget[0] <= 0 or depth > 8:
        return "[truncated]"
    if isinstance(value, dict):
        out = {}
        # Kafka config entries identify secrets in their name, not in the value key.
        secret_entry = value.get("isSensitive") or SENSITIVE.search(str(value.get("name", "")))
        for key, val in list(value.items())[:MAX_RECORDS]:
            if budget[0] <= 0:
                out["_truncated"] = True
                break
            key = str(key)[:200]
            budget[0] -= len(key)
            if SENSITIVE.search(key) or key in OMITTED or (secret_entry and key == "value"):
                out[key] = "[redacted]"
            else:
                out[key] = bounded_data(val, budget=budget, depth=depth + 1)
        return out
    if isinstance(value, list | tuple):
        result = []
        for item in value[:MAX_RECORDS]:
            if budget[0] <= 0:
                result.append("[truncated]")
                break
            result.append(bounded_data(item, budget=budget, depth=depth + 1))
        return result
    if isinstance(value, str):
        # Metadata identifiers may themselves contain credentials. Suppress suspicious text.
        if SENSITIVE.search(value) or re.search(r"\bBearer\s|://[^/\s]+:[^/\s]+@", value, re.I):
            return "[redacted]"
        out = value[: min(500, max(budget[0], 0))]
        budget[0] -= len(out)
        return out
    if value is None or isinstance(value, bool | int | float):
        budget[0] -= 16
        return value
    return "[omitted]"


async def check_authority(
    request: Request,
    principal: Principal,
    cluster_id: str,
    mutation: bool = False,
) -> tuple[Principal, ClusterContext]:
    """Intersect session claims with current local grants on *every* invocation."""
    settings = request.app.state.settings
    policy = getattr(settings, "agent", None)
    if policy is None or not policy.enabled:
        raise Forbidden("K-Shui Agent is disabled by the administrator")
    if principal.anonymous or settings.auth.type == "none":
        raise Unauthorized("K-Shui Agent requires an authenticated human user")
    expiry = principal.claims.get("exp")
    if expiry is not None and float(expiry) <= time.time():
        raise Unauthorized("session expired")
    role = principal.role
    grants = principal.clusters
    current = None
    if db_session.is_ready():
        async with db_session.session_scope() as session:
            current = (
                await session.execute(select(User).where(User.username == principal.username))
            ).scalar_one_or_none()
    if current is None:
        current = next((u for u in settings.auth.users if u.username == principal.username), None)
        if current is None and settings.auth.type == "basic":
            raise Unauthorized("user no longer exists")
    if current is not None:
        from k_shui.core.auth import ROLE_RANK

        role = min((role, current.role), key=lambda r: ROLE_RANK.get(r, -1))
        if current.clusters is not None:
            grants = (
                list(current.clusters) if grants is None else [c for c in grants if c in current.clusters]
            )
    fresh = Principal(principal.username, role, grants, claims=principal.claims)
    if not fresh.can("editor" if mutation else "viewer") or not fresh.sees_cluster(cluster_id):
        raise Forbidden("user has insufficient permission for this cluster and operation")
    allowed = getattr(policy, "allowedClusters", None)
    if allowed is not None and cluster_id not in allowed:
        raise Forbidden("cluster is outside deployment agent policy")
    ctx = request.app.state.registry.get(cluster_id)
    if ctx is None:
        raise NotFound("cluster not found")
    if mutation:
        if not getattr(policy, "allowMutations", False):
            raise Forbidden("agent operations are disabled by deployment policy")
        if settings.server.readOnly or ctx.config.readOnly:
            raise ReadOnly("cluster or deployment is read-only")
    return fresh, ctx


def resource_link(cluster_id: str, kind: str, name: str = "", integration: str = "") -> str:
    base = "/c/" + quote(cluster_id, safe="")
    paths = {
        "topic": "topics",
        "group": "consumers",
        "connector": "connect",
        "job": "flink",
        "schema": "schemas",
    }
    if kind == "cluster":
        return base + "/overview"
    if kind == "alert":
        return "/alerts?cluster=" + quote(cluster_id, safe="") + "&event=" + quote(name, safe="")
    if kind == "audit":
        return "/audit?cluster=" + quote(cluster_id, safe="")
    if kind == "lineage":
        return base + "/lineage?focus=" + quote(name, safe="")
    path = base + "/" + paths[kind]
    if integration:
        path += "/" + quote(integration, safe="") + ("/connectors" if kind == "connector" else "/jobs")
    return path + "/" + quote(name, safe="")


def _definition(
    name: str, description: str, required: list[str], properties: dict[str, Any]
) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": False,
            },
        },
    }


STRING = {"type": "string", "minLength": 1, "maxLength": 249}
TOOL_DEFINITIONS = [
    _definition(
        "get_cluster_health", "Retrieve current Kafka metadata and sampled partition health.", [], {}
    ),
    _definition(
        "get_topic_metadata",
        "Retrieve topic partitions and safe non-secret configuration.",
        ["name"],
        {"name": STRING},
    ),
    _definition(
        "get_group_lag",
        "Retrieve current lag and up to 60 complete samples from the last 15 minutes; "
        "net backlog change is not a cause or a production/consumption rate.",
        ["name"],
        {"name": STRING},
    ),
    _definition(
        "get_connector_task_errors",
        "Retrieve task states; raw traces omitted by data policy.",
        ["name", "connectName"],
        {"name": STRING, "connectName": STRING},
    ),
    _definition(
        "get_job_checkpoint_summary",
        "Retrieve job state and checkpoint summary.",
        ["name", "flinkName"],
        {"name": STRING, "flinkName": STRING},
    ),
    _definition(
        "get_lineage_neighbors",
        "Retrieve one-hop neighbors. Missing sources mean incomplete lineage.",
        ["name"],
        {"name": STRING},
    ),
    _definition(
        "get_schema_summary",
        "Retrieve latest schema field types and compatibility policy; no descriptions or defaults.",
        ["name"],
        {"name": STRING},
    ),
    _definition(
        "get_alert_evidence",
        "Retrieve a specific alert event in this investigation cluster.",
        ["name"],
        {"name": STRING},
    ),
    _definition("get_audit_events", "Retrieve recent scoped audit headers; details excluded.", [], {}),
]


async def inspect_tool(
    request: Request, principal: Principal, cluster_id: str, name: str, arguments: dict[str, Any]
) -> dict[str, Any]:
    fresh, ctx = await check_authority(request, principal, cluster_id)
    definitions = {d["function"]["name"]: d["function"]["parameters"] for d in TOOL_DEFINITIONS}
    if name not in definitions:
        raise BadRequest("tool is not allowlisted")
    allowed = getattr(request.app.state.settings.agent, "allowedTools", None)
    if allowed is not None and name not in allowed:
        raise Forbidden("tool is disabled by deployment policy")
    schema = definitions[name]
    if set(arguments) - set(schema["properties"]) or any(k not in arguments for k in schema["required"]):
        raise BadRequest("invalid tool arguments; cluster is fixed by the investigation")
    if any(not isinstance(v, str) or not v or len(v) > 249 for v in arguments.values()):
        raise BadRequest("resource names must be nonempty strings of at most 249 characters")
    kind = {
        "get_cluster_health": "cluster",
        "get_topic_metadata": "topic",
        "get_group_lag": "group",
        "get_connector_task_errors": "connector",
        "get_job_checkpoint_summary": "job",
        "get_lineage_neighbors": "lineage",
        "get_audit_events": "audit",
        "get_schema_summary": "schema",
        "get_alert_evidence": "alert",
    }[name]
    evidence = {
        "id": uuid.uuid4().hex,
        "clusterId": cluster_id,
        "tool": name,
        "resource": arguments,
        "href": resource_link(
            cluster_id,
            kind,
            arguments.get("name", ""),
            arguments.get("connectName", arguments.get("flinkName", "")),
        ),
        "observedAt": datetime.now(UTC).isoformat(),
        "status": "fresh",
        "data": {},
        "limitations": [
            "Metadata only; payloads and free-form logs excluded. At most 100 records and 24 KB."
        ],
    }
    try:
        async with asyncio.timeout(15):
            data = await _collect(request, fresh, ctx, name, arguments)
        evidence["data"] = bounded_data(data)
        if name == "get_group_lag":
            trend = data["trend"]
            if trend["status"] != "available":
                evidence["status"] = "partial"
            evidence["limitations"].extend(trend["limitations"])
        if name == "get_schema_summary":
            evidence["status"] = "partial"
            evidence["limitations"].append(
                "Candidate schema and compatibility error are unavailable. Open the subject's "
                "compatibility check, supply the candidate there, and inspect the validation errors."
            )
        if name == "get_cluster_health":
            health = data.get("partitionHealth")
            if health is None:
                evidence["status"] = "partial"
                evidence["limitations"].append(
                    "Partition health telemetry is unavailable; "
                    "live broker metadata does not establish health."
                )
            elif health.get("stale"):
                evidence["status"] = "stale"
                evidence["limitations"].append(
                    "Partition health is an older sample, not current health; "
                    "inspect sampledAt before acting."
                )
        if name == "get_lineage_neighbors":
            evidence["href"] = resource_link(cluster_id, "lineage", data.get("focus", arguments["name"]))
            evidence["status"] = "partial"
            evidence["limitations"].append(
                "Unavailable lineage sources may be absent; no edge does not prove no dependency."
            )
    except asyncio.CancelledError:
        raise
    except Exception:
        # Upstream error strings can contain credentials, payloads and untrusted instructions.
        evidence["status"] = "unavailable"
        evidence["limitations"].append(
            "Source retrieval failed or timed out. No healthy or zero conclusion is supported."
        )
    return evidence


def _lag_trend(request: Request, cluster_id: str, group_id: str) -> dict[str, Any]:
    from k_shui.core.sampler import get_sampler

    stamp = time.time()
    sampler = get_sampler(request, cluster_id)
    samples = [s for s in sampler.samples if stamp - 900 <= s.ts <= stamp][-60:] if sampler else []
    # Use only the latest contiguous series with a complete, unchanged partition set.
    usable = []
    partition_set = None
    for sample in reversed(samples):
        parts = sample.per_group_scope.get(group_id)
        if sample.error or group_id not in sample.per_group or not parts:
            break
        if partition_set is not None and parts != partition_set:
            break
        if usable and not 0 < usable[-1].ts - sample.ts <= max(120, sampler.interval * 3):
            break
        partition_set = parts
        usable.append(sample)
    usable.reverse()
    points = [
        {"sampledAt": datetime.fromtimestamp(s.ts, UTC).isoformat(), "lag": s.per_group[group_id]}
        for s in usable
    ]
    status = "available" if len(points) >= 2 else "unavailable"
    if usable and stamp - usable[-1].ts > max(120, sampler.interval * 3):
        status = "stale"
    delta = usable[-1].per_group[group_id] - usable[0].per_group[group_id] if len(usable) >= 2 else None
    limitations = [
        "Last 15 minutes only, up to 60 complete samples with an unchanged partition set. "
        "Net backlog change does not establish cause, production/consumption rates, "
        "or successful processing; offset resets and retention can also change lag."
    ]
    if status != "available":
        limitations.append(
            "Recent comparable lag history is missing or stale; growth/drain cannot be established now. "
            "Open the consumer group's lag chart, check sampling, wait for two complete samples, "
            "then refresh evidence."
        )
    return {
        "status": status,
        "points": points,
        "netChange": delta,
        "direction": ("growing" if delta > 0 else "draining" if delta < 0 else "unchanged")
        if status == "available" and delta is not None
        else "unknown",
        "limitations": limitations,
    }


async def _collect(
    request: Request, principal: Principal, ctx: ClusterContext, name: str, args: dict[str, Any]
) -> Any:
    admin = KafkaAdmin.get(ctx)
    target = args.get("name", "")
    if name == "get_cluster_health":
        info = await admin.describe_cluster()
        manager = getattr(request.app.state, "samplers", None)
        sampler = manager.get(ctx.id) if manager else None
        sample = sampler.latest if sampler else None
        return {
            "metadata": info,
            "partitionHealth": None
            if sample is None or sample.error
            else {
                "offlinePartitions": sample.offline_partitions,
                "underReplicatedPartitions": sample.under_replicated,
                "sampledAt": datetime.fromtimestamp(sample.ts, UTC).isoformat(),
                "stale": time.time() - sample.ts > 120,
            },
            "telemetryStatus": "unavailable" if sample is None or sample.error else "sampled",
        }
    if name == "get_topic_metadata":
        topic = await admin.describe_topic(target)
        configs = await admin.describe_configs("topic", target)
        topic["configs"] = {
            e["name"]: e.get("value")
            for e in configs
            if e["name"] in SAFE_CONFIGS and not e.get("isSensitive")
        }
        return topic
    if name == "get_group_lag":
        groups = await admin.describe_groups([target])
        group = groups.get(target)
        if not group or group.get("error"):
            raise NotFound("group not found")
        all_offsets = await admin.group_offsets(target)
        offsets = all_offsets[:MAX_RECORDS]
        marks = await admin.watermarks([(o["topic"], o["partition"]) for o in offsets])
        return {
            "groupId": target,
            "trend": _lag_trend(request, ctx.id, target),
            "partitionCount": len(all_offsets),
            "partitionsTruncated": len(all_offsets) > MAX_RECORDS,
            "membership": group,
            "partitions": [
                {
                    **o,
                    "endOffset": marks.get((o["topic"], o["partition"]), (None, None))[1],
                    "lag": max(marks[(o["topic"], o["partition"])][1] - o["offset"], 0)
                    if (o["topic"], o["partition"]) in marks and o["offset"] >= 0
                    else None,
                }
                for o in offsets
            ],
            "note": "Stable describes membership only. Missing watermarks/offsets mean unknown lag.",
        }
    if name == "get_connector_task_errors":
        from k_shui.integrations.connect import get_connect

        raw = await get_connect(ctx, args["connectName"]).status(target)
        return {
            "name": target,
            "connector": _task_summary(raw.get("connector", {})),
            "tasks": [_task_summary(t) for t in raw.get("tasks", [])[:MAX_RECORDS]],
        }
    if name == "get_job_checkpoint_summary":
        from k_shui.integrations.flink import get_flink

        client = get_flink(ctx, args["flinkName"])
        job = await client.job(target)
        checkpoints = await client.checkpoints(target)
        return {
            "job": {
                k: job.get(k) for k in ("jid", "name", "state", "start-time", "end-time", "duration", "tasks")
            },
            "checkpoints": checkpoints,
        }
    if name == "get_lineage_neighbors":
        from k_shui.integrations.lineage_builder import build

        graph = await build(ctx)
        focus = target if target in graph.nodes else f"topic:{ctx.id}:{target}"
        return graph.bfs(focus, 1)
    if name == "get_schema_summary":
        import json

        from k_shui.integrations.schema_registry import get_schema_registry

        client = get_schema_registry(ctx)
        version = await client.get_version(target)
        config = await client.get_subject_config(target)
        if not config.get("compatibility"):
            config = await client.get_global_config()
        try:
            parsed = json.loads(version.get("schema", "{}"))
        except (ValueError, TypeError):
            parsed = {}
        fields = parsed.get("fields", []) if isinstance(parsed, dict) else []
        return {
            "subject": target,
            "version": version.get("version"),
            "schemaId": version.get("id"),
            "schemaType": version.get("schemaType"),
            "compatibility": config.get("compatibility"),
            "fields": [
                {"name": f.get("name"), "type": _schema_type(f.get("type")), "hasDefault": "default" in f}
                for f in fields[:MAX_RECORDS]
                if isinstance(f, dict)
            ],
            "note": (
                "Latest registered metadata only. Candidate schema and compatibility error "
                "are not available; compatibility cannot be inferred."
            ),
        }
    if name == "get_alert_evidence":
        from k_shui.db.models import AlertHistory

        async with db_session.session_scope() as session:
            row = (
                await session.execute(
                    select(AlertHistory).where(AlertHistory.id == target, AlertHistory.cluster_id == ctx.id)
                )
            ).scalar_one_or_none()
            if row is None:
                raise NotFound("alert event not found in this cluster")
            data = row.to_dict()
            return {
                k: data.get(k)
                for k in (
                    "id",
                    "triggerId",
                    "component",
                    "target",
                    "clusterId",
                    "severity",
                    "status",
                    "value",
                    "threshold",
                    "firedAt",
                    "resolvedAt",
                    "ackedAt",
                )
            }
    from k_shui.core.audit import list_audit

    # Existing global audit UI is viewer-accessible; keep strict cluster filtering here.
    rows = await list_audit(per_page=50, cluster_id=ctx.id)
    return {
        "items": [
            {k: row.get(k) for k in ("id", "ts", "user", "action", "resource", "clusterId", "status")}
            for row in rows["items"]
        ]
    }


def _schema_type(value: Any) -> Any:
    """Expose type structure without nested documentation, defaults or arbitrary values."""
    if isinstance(value, list):
        return [_schema_type(v) for v in value[:20]]
    if isinstance(value, dict):
        return {k: _schema_type(value[k]) for k in ("type", "items", "values") if k in value}
    return value if isinstance(value, str) else None


def _task_summary(task: dict[str, Any]) -> dict[str, Any]:
    trace = str(task.get("trace", ""))[:16000]
    categories = {
        "authentication": ("AuthenticationException", "SaslAuthenticationException"),
        "authorization": ("AuthorizationException", "TopicAuthorizationException"),
        "timeout": ("TimeoutException", "SocketTimeoutException"),
        "connectivity": ("ConnectException", "UnknownHostException"),
        "serialization": ("SerializationException", "DataException", "SchemaProjectorException"),
        "missing_resource": ("UnknownTopicOrPartitionException",),
    }
    found = [
        category for category, markers in categories.items() if any(marker in trace for marker in markers)
    ]
    return {
        "id": task.get("id"),
        "state": task.get("state"),
        "errorCategories": found,
        "errorSummary": (
            "Known exception markers in untrusted source trace; cause still requires verification."
        )
        if found
        else "Raw error details omitted by data policy."
        if trace
        else None,
    }
