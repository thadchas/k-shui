"""Async-friendly wrapper over ``confluent_kafka.admin.AdminClient``.

Blocking librdkafka work (waiting on futures, polling) runs in a worker thread via
``asyncio.to_thread``. Constructing cimpl objects and issuing admin requests stays on the
event-loop thread: doing that from a pool thread corrupts the client's memory
(reproduced with confluent-kafka 2.15). Metadata is cached for a few seconds.
"""

from __future__ import annotations

import asyncio
import random
from typing import Any

from cachetools import TTLCache

from k_shui.core.errors import BadRequest, IntegrationUnavailable, KShuiError, NotFound, UpstreamError
from k_shui.core.logging import get_logger, mask
from k_shui.core.registry import ClusterContext
from k_shui.kafka.security import SecurityAdminMixin

log = get_logger(__name__)

METADATA_TTL = 5.0
DEFAULT_TIMEOUT = 15.0
# Watermarks are fetched one partition at a time, so an unreachable broker would
# otherwise cost `partitions * timeout` (minutes on a large cluster). Bound both the
# individual call and the whole sweep.
WATERMARK_TIMEOUT = 5.0
WATERMARK_BUDGET = 10.0
# librdkafka clients can stay wedged after a broker outage (every request keeps failing
# with _TRANSPORT even once the broker is back). Rebuild the client after this many
# consecutive transport failures so a cluster recovers without restarting k-shui.
RECYCLE_AFTER_TRANSPORT_FAILURES = 3
RESOURCE_ALIASES = {"topic": "TOPIC", "broker": "BROKER", "cluster": "BROKER", "group": "GROUP"}


class UnsupportedFeature(KShuiError):
    """The installed confluent-kafka / broker version does not implement this API."""

    status, type, title = 501, "unsupported-feature", "Not supported"


def _client_version() -> str:
    from confluent_kafka import version

    return str(version())


def client_config(ctx: ClusterContext, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """librdkafka config for a cluster: bootstrap servers + raw ``properties`` + overrides."""
    cfg: dict[str, Any] = {"bootstrap.servers": ctx.config.bootstrapServers}
    cfg.update({k: v for k, v in (ctx.config.properties or {}).items() if v is not None})
    cfg.update(extra or {})
    return cfg


class KafkaAdmin(SecurityAdminMixin):
    """One instance per cluster, cached on the :class:`ClusterContext`."""

    def __init__(self, ctx: ClusterContext, timeout: float = DEFAULT_TIMEOUT) -> None:
        self.ctx = ctx
        self.cluster_id = ctx.config.id
        self.timeout = timeout
        self._config = client_config(ctx)
        self._admin: Any = None
        self._consumer: Any = None
        self._transport_failures = 0
        self._needs_recycle = False
        self._consumer_lock = asyncio.Lock()
        self._cache: TTLCache[str, Any] = TTLCache(maxsize=64, ttl=METADATA_TTL)

    # ------------------------------------------------------------------ plumbing
    @classmethod
    def from_context(cls, ctx: ClusterContext) -> KafkaAdmin:
        return cls(ctx)

    @staticmethod
    def get(ctx: ClusterContext) -> KafkaAdmin:
        return ctx.client("kafka_admin", KafkaAdmin.from_context)

    def _recycle_if_needed(self) -> None:
        """Drop wedged cimpl clients so the next call builds fresh ones.

        The references are released rather than closed: a worker thread may still be
        inside a call on the old object, and closing it underneath that thread is not
        safe. Python finalises them once the last reference goes.
        """
        if not self._needs_recycle:
            return
        self._needs_recycle = False
        self._transport_failures = 0
        self._admin = None
        self._consumer = None
        self._cache.clear()
        log.info("kafka.admin.recycled", cluster=self.cluster_id)

    @property
    def admin(self) -> Any:
        self._recycle_if_needed()
        if self._admin is None:
            from confluent_kafka.admin import AdminClient

            log.debug(
                "kafka.admin.create",
                cluster=self.cluster_id,
                config={k: mask(k, v) for k, v in self._config.items()},
            )
            self._admin = AdminClient(self._config)
        return self._admin

    async def _call(self, fn: Any, *args: Any, **kwargs: Any) -> Any:
        """Run a blocking admin call in a thread, translating errors."""
        try:
            result = await asyncio.to_thread(fn, *args, **kwargs)
        except Exception as exc:
            translated = self._translate(exc)
            if isinstance(translated, IntegrationUnavailable):
                self._transport_failures += 1
                if self._transport_failures >= RECYCLE_AFTER_TRANSPORT_FAILURES:
                    # flagged, not rebuilt here: this call may still hold the client
                    self._needs_recycle = True
            raise translated from exc
        self._transport_failures = 0
        return result

    def _translate(self, exc: Exception) -> Exception:
        text = str(exc)
        if "_TIMED_OUT" in text or "_TRANSPORT" in text or "_ALL_BROKERS_DOWN" in text or "_RESOLVE" in text:
            return IntegrationUnavailable(f"kafka cluster '{self.cluster_id}' unreachable: {text}")
        if "UNKNOWN_TOPIC" in text or "UNKNOWN_PARTITION" in text or "GROUP_ID_NOT_FOUND" in text:
            return NotFound(text)
        if "already exists" in text or "TOPIC_ALREADY_EXISTS" in text:
            from k_shui.core.errors import Conflict

            return Conflict(text)
        return UpstreamError(text)

    async def _resolve(self, fut: Any) -> Any:
        return await self._call(fut.result, self.timeout)

    async def _resolve_map(self, futures: dict[Any, Any]) -> dict[Any, Any]:
        out: dict[Any, Any] = {}
        for key, fut in futures.items():
            out[key] = await self._resolve(fut)
        return out

    async def close(self) -> None:
        if self._consumer is not None:
            consumer, self._consumer = self._consumer, None
            await asyncio.to_thread(consumer.close)
        self._admin = None

    # ------------------------------------------------------------------ metadata
    async def metadata(self, topic: str | None = None, force: bool = False) -> Any:
        key = f"md:{topic or '*'}"
        if not force and key in self._cache:
            return self._cache[key]
        md = (
            await self._call(self.admin.list_topics, topic, self.timeout)
            if topic
            else await self._call(self.admin.list_topics, None, self.timeout)
        )
        self._cache[key] = md
        return md

    async def ping(self) -> bool:
        await self.metadata()
        return True

    async def describe_cluster(self) -> dict[str, Any]:
        md = await self.metadata()
        brokers = [
            {"id": b.id, "host": b.host, "port": b.port, "rack": getattr(b, "rack", None) or None}
            for b in md.brokers.values()
        ]
        info: dict[str, Any] = {
            "clusterId": md.cluster_id,
            "controllerId": md.controller_id,
            "brokers": sorted(brokers, key=lambda b: b["id"]),
            "brokerCount": len(brokers),
            "topicCount": len(md.topics),
            "partitionCount": sum(len(t.partitions) for t in md.topics.values()),
            "listeners": sorted({f"{b['host']}:{b['port']}" for b in brokers}),
        }
        try:
            desc = await self._resolve(self.admin.describe_cluster(request_timeout=self.timeout))
            info["clusterId"] = desc.cluster_id or info["clusterId"]
            if getattr(desc, "controller", None) is not None:
                info["controllerId"] = desc.controller.id
        except Exception as exc:  # optional API
            log.debug("kafka.describe_cluster_failed", cluster=self.cluster_id, error=str(exc))
        return info

    async def broker_version(self) -> str | None:
        """Best-effort broker version. Kafka 4.x drops the IBP config, so this may be ``None``."""
        md = await self.metadata()
        if not md.brokers:
            return None
        broker_id = next(iter(md.brokers))
        try:
            configs = await self.describe_configs("broker", str(broker_id))
        except Exception:
            return None
        by_name = {c["name"]: c["value"] for c in configs}
        for key in ("inter.broker.protocol.version", "metadata.version", "log.message.format.version"):
            value = by_name.get(key)
            if value:
                return str(value).split("-")[0]
        return None

    async def kraft_quorum(self) -> dict[str, Any]:
        """KRaft quorum info; ``supported: False`` when the client build lacks the API."""
        if hasattr(self.admin, "describe_metadata_quorum"):
            try:
                result = await self._resolve(
                    self.admin.describe_metadata_quorum(request_timeout=self.timeout)
                )
                return _quorum_to_dict(result)
            except Exception as exc:
                log.debug("kafka.quorum_failed", cluster=self.cluster_id, error=str(exc))
        md = await self.metadata()
        voters: list[dict[str, Any]] = []
        try:
            broker_id = next(iter(md.brokers))
            configs = {c["name"]: c["value"] for c in await self.describe_configs("broker", str(broker_id))}
            raw = configs.get("controller.quorum.voters") or ""
            for entry in [e for e in str(raw).split(",") if e.strip()]:
                node_id = entry.split("@", 1)[0].strip()
                if node_id.isdigit():
                    voters.append(
                        {
                            "id": int(node_id),
                            "logEndOffset": None,
                            "lastFetchTs": None,
                            "lastCaughtUpTs": None,
                            "lag": None,
                        }
                    )
        except Exception:
            voters = []
        return {
            "supported": False,
            "reason": "describe_metadata_quorum unavailable in this confluent-kafka build",
            "leaderId": md.controller_id,
            "leaderEpoch": None,
            "highWatermark": None,
            "voters": voters,
            "observers": [],
        }

    # ------------------------------------------------------------------ topics
    async def list_topics(self, include_internal: bool = True) -> list[dict[str, Any]]:
        md = await self.metadata()
        out: list[dict[str, Any]] = []
        for name, t in md.topics.items():
            internal = name.startswith("__")
            if not include_internal and internal:
                continue
            partitions = list(t.partitions.values())
            urp = sum(1 for p in partitions if len(p.isrs) < len(p.replicas))
            rf = max((len(p.replicas) for p in partitions), default=0)
            out.append(
                {
                    "name": name,
                    "partitions": len(partitions),
                    "replicationFactor": rf,
                    "isInternal": internal,
                    "underReplicatedPartitions": urp,
                    "offlinePartitions": sum(1 for p in partitions if p.leader < 0),
                    "error": str(t.error) if t.error else None,
                }
            )
        return sorted(out, key=lambda t: t["name"])

    async def describe_topic(self, topic: str) -> dict[str, Any]:
        md = await self.metadata()
        t = md.topics.get(topic)
        if t is None or (t.error and "UNKNOWN_TOPIC" in str(t.error)):
            raise NotFound(f"topic '{topic}' not found")
        partitions = [
            {
                "id": p.id,
                "leader": p.leader,
                "replicas": list(p.replicas),
                "isr": list(p.isrs),
                "underReplicated": len(p.isrs) < len(p.replicas),
                "offline": p.leader < 0,
            }
            for p in sorted(t.partitions.values(), key=lambda p: p.id)
        ]
        return {
            "name": topic,
            "isInternal": topic.startswith("__"),
            "partitions": len(partitions),
            "replicationFactor": max((len(p["replicas"]) for p in partitions), default=0),
            "partitionsDetail": partitions,
        }

    async def create_topic(
        self,
        name: str,
        partitions: int = 1,
        replication_factor: int = -1,
        configs: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        from confluent_kafka.admin import NewTopic

        topic = NewTopic(
            name, num_partitions=partitions, replication_factor=replication_factor, config=configs or {}
        )
        await self._resolve_map(self.admin.create_topics([topic], request_timeout=self.timeout))
        self._cache.clear()
        return {"name": name, "partitions": partitions, "replicationFactor": replication_factor}

    async def delete_topic(self, name: str) -> None:
        await self._resolve_map(self.admin.delete_topics([name], request_timeout=self.timeout))
        self._cache.clear()

    async def create_partitions(self, topic: str, total_count: int) -> dict[str, Any]:
        from confluent_kafka.admin import NewPartitions

        await self._resolve_map(
            self.admin.create_partitions([NewPartitions(topic, total_count)], request_timeout=self.timeout)
        )
        self._cache.clear()
        return {"name": topic, "partitions": total_count}

    async def delete_records(self, offsets: list[tuple[str, int, int]]) -> list[dict[str, Any]]:
        """``offsets``: (topic, partition, before_offset). ``-1`` deletes up to the high watermark."""
        if not offsets:
            return []
        from confluent_kafka import TopicPartition

        # librdkafka objects must be built on the loop thread: constructing TopicPartition
        # inside a worker thread corrupts the client's memory (observed with 2.15 on macOS).
        tps = [TopicPartition(t, p, o) for t, p, o in offsets]
        futures = self.admin.delete_records(tps, request_timeout=self.timeout)
        # Snapshot the keys before awaiting — they are not safe to read afterwards.
        pending = [(str(tp.topic), int(tp.partition), fut) for tp, fut in list(futures.items())]
        out: list[dict[str, Any]] = []
        for topic, part, fut in pending:
            try:
                res = await self._resolve(fut)
                out.append(
                    {"topic": topic, "partition": part, "lowWatermark": getattr(res, "low_watermark", None)}
                )
            except Exception as exc:
                out.append({"topic": topic, "partition": part, "error": str(exc)})
        return out

    # ------------------------------------------------------------------ offsets
    def _watermark_consumer(self) -> Any:
        self._recycle_if_needed()
        if self._consumer is None:
            from confluent_kafka import Consumer

            cfg = client_config(
                self.ctx,
                {
                    "group.id": f"k-shui-watermarks-{random.randint(0, 1 << 30)}",
                    "enable.auto.commit": False,
                    "auto.offset.reset": "earliest",
                    "socket.timeout.ms": int(self.timeout * 1000),
                },
            )
            self._consumer = Consumer(cfg)
        return self._consumer

    async def watermarks(
        self,
        partitions: list[tuple[str, int]],
        per_partition: float | None = None,
        budget: float | None = None,
    ) -> dict[tuple[str, int], tuple[int, int]]:
        """Begin/end offsets for many partitions in a single worker-thread hop.

        ``per_partition`` caps each partition lookup and ``budget`` the whole sweep; once the
        budget is spent the remaining partitions report ``(0, 0)`` rather than letting a
        dead broker stall the caller for ``partitions * timeout`` seconds.
        """
        if not partitions:
            return {}
        import time as _time

        from confluent_kafka import TopicPartition

        consumer = self._watermark_consumer()
        tps = [(t, p, TopicPartition(t, p)) for t, p in partitions]
        per_call = per_partition if per_partition is not None else min(self.timeout, WATERMARK_TIMEOUT)
        total = budget if budget is not None else WATERMARK_BUDGET

        def _run() -> tuple[dict[tuple[str, int], tuple[int, int]], bool, bool]:
            result: dict[tuple[str, int], tuple[int, int]] = {}
            deadline = _time.monotonic() + total if total else None
            expired = False
            transport_failure = False
            succeeded = False
            for topic, part, tp in tps:
                if expired:
                    result[(topic, part)] = (0, 0)
                    continue
                call_timeout = per_call
                if deadline is not None:
                    remaining = deadline - _time.monotonic()
                    if remaining <= 0:
                        expired = True
                        result[(topic, part)] = (0, 0)
                        log.debug("kafka.watermark_budget_exhausted", cluster=self.cluster_id)
                        continue
                    call_timeout = min(per_call, remaining)
                try:
                    low, high = consumer.get_watermark_offsets(tp, timeout=call_timeout, cached=False)
                    result[(topic, part)] = (low, high)
                    succeeded = True
                except Exception as exc:
                    text = str(exc)
                    if "_TIMED_OUT" in text or "_TRANSPORT" in text or "_ALL_BROKERS_DOWN" in text:
                        transport_failure = True
                    log.debug("kafka.watermark_failed", topic=topic, partition=part, error=text)
                    result[(topic, part)] = (0, 0)
            return result, transport_failure, succeeded

        async with self._consumer_lock:
            # Plain thread hop, not ``_call``: _run never raises, and _call's success path
            # would reset the failure counter before the accounting below could act.
            result, transport_failure, succeeded = await asyncio.to_thread(_run)
        # Swallowed per-partition errors never reach ``_call``'s accounting, so a wedged
        # watermark consumer would otherwise survive forever (only a process restart cured
        # it). Count all-failed sweeps here so the recycle logic applies to it too.
        if transport_failure and not succeeded:
            self._transport_failures += 1
            if self._transport_failures >= RECYCLE_AFTER_TRANSPORT_FAILURES:
                self._needs_recycle = True
                log.warning("kafka.watermark_consumer_wedged", cluster=self.cluster_id)
        elif succeeded:
            self._transport_failures = 0
        return result

    async def offsets_for_times(self, partitions: list[tuple[str, int, int]]) -> dict[tuple[str, int], int]:
        """(topic, partition, timestamp_ms) → offset (-1 when past the end)."""
        if not partitions:
            return {}
        from confluent_kafka import TopicPartition

        consumer = self._watermark_consumer()
        tps = [TopicPartition(t, p, ts) for t, p, ts in partitions]

        def _run() -> list[tuple[str, int, int]]:
            resolved = consumer.offsets_for_times(tps, timeout=self.timeout)
            return [(str(tp.topic), int(tp.partition), int(tp.offset)) for tp in resolved]

        async with self._consumer_lock:
            rows = await self._call(_run)
        return {(topic, part): offset for topic, part, offset in rows}

    # ------------------------------------------------------------------ configs
    @staticmethod
    def _resource(kind: str, name: str | None) -> Any:
        from confluent_kafka.admin import ConfigResource

        upper = RESOURCE_ALIASES.get(kind.lower())
        if upper is None:
            raise BadRequest(f"unknown config resource type '{kind}'")
        if not name:
            raise BadRequest(f"config resource '{kind}' requires a name")
        return ConfigResource(getattr(ConfigResource.Type, upper), str(name))

    async def _controller_id(self) -> int:
        md = await self.metadata()
        if md.controller_id is not None and md.controller_id >= 0:
            return int(md.controller_id)
        if not md.brokers:
            raise IntegrationUnavailable(f"cluster '{self.cluster_id}' has no reachable brokers")
        return int(next(iter(md.brokers)))

    async def describe_configs(self, kind: str, name: str | None = None) -> list[dict[str, Any]]:
        """``kind='cluster'`` returns the dynamic broker configs of the controller.

        librdkafka rejects the empty-named BROKER resource that Kafka uses for cluster-wide
        defaults, so the controller's dynamic entries stand in for it.
        """
        if kind.lower() == "cluster":
            entries = await self.describe_configs("broker", str(await self._controller_id()))
            return [e for e in entries if (e["source"] or "").startswith("DYNAMIC")]
        resource = self._resource(kind, name)
        results = await self._resolve_map(
            self.admin.describe_configs([resource], request_timeout=self.timeout)
        )
        entries = next(iter(results.values()), {})
        out = []
        for entry in entries.values():
            out.append(
                {
                    "name": entry.name,
                    "value": None if entry.is_sensitive else entry.value,
                    "source": _config_source_name(getattr(entry, "source", None)),
                    "isDefault": bool(getattr(entry, "is_default", False)),
                    "isReadOnly": bool(getattr(entry, "is_read_only", False)),
                    "isSensitive": bool(getattr(entry, "is_sensitive", False)),
                    "documentation": None,
                    "synonyms": [s.name for s in (getattr(entry, "synonyms", None) or {}).values()],
                }
            )
        return sorted(out, key=lambda c: c["name"])

    async def alter_configs(
        self, kind: str, name: str | None, configs: dict[str, Any]
    ) -> list[dict[str, Any]]:
        """Incremental alter: ``None`` value deletes (resets) the entry."""
        from confluent_kafka.admin import AlterConfigOpType, ConfigEntry

        if kind.lower() == "cluster":
            md = await self.metadata()
            for broker_id in sorted(md.brokers):
                await self.alter_configs("broker", str(broker_id), configs)
            return await self.describe_configs("cluster")
        resource = self._resource(kind, name)
        resource.incremental_configs = [
            ConfigEntry(
                key,
                None if value is None else str(value),
                incremental_operation=AlterConfigOpType.DELETE if value is None else AlterConfigOpType.SET,
            )
            for key, value in configs.items()
        ]
        await self._resolve_map(
            self.admin.incremental_alter_configs([resource], request_timeout=self.timeout)
        )
        self._cache.clear()
        return await self.describe_configs(kind, name)

    # ------------------------------------------------------------------ log dirs
    async def describe_log_dirs(self, broker_ids: list[int] | None = None) -> dict[str, Any]:
        if hasattr(self.admin, "describe_log_dirs"):
            try:
                result = await self._resolve(self.admin.describe_log_dirs(request_timeout=self.timeout))  # type: ignore[attr-defined]
                return {"supported": True, "brokers": _logdirs_to_dict(result)}
            except Exception as exc:
                log.debug("kafka.logdirs_failed", cluster=self.cluster_id, error=str(exc))
        md = await self.metadata()
        brokers: dict[str, Any] = {}
        for broker_id in sorted(md.brokers):
            if broker_ids and broker_id not in broker_ids:
                continue
            try:
                configs = {
                    c["name"]: c["value"] for c in await self.describe_configs("broker", str(broker_id))
                }
                paths = [
                    p.strip()
                    for p in str(configs.get("log.dirs") or configs.get("log.dir") or "").split(",")
                    if p.strip()
                ]
            except Exception:
                paths = []
            assigned = [
                {"topic": name, "partition": p.id, "sizeBytes": None, "offsetLag": None}
                for name, t in md.topics.items()
                for p in t.partitions.values()
                if broker_id in p.replicas
            ]
            brokers[str(broker_id)] = [
                {"path": path, "sizeBytes": None, "partitions": assigned if i == 0 else []}
                for i, path in enumerate(paths or ["<unknown>"])
            ]
        return {
            "supported": False,
            "reason": "describe_log_dirs unavailable in this confluent-kafka build",
            "brokers": brokers,
        }

    # ------------------------------------------------------------------ consumer groups
    async def list_groups(
        self, states: list[str] | None = None, types: list[str] | None = None
    ) -> list[dict[str, Any]]:
        from confluent_kafka import ConsumerGroupState, ConsumerGroupType

        kwargs: dict[str, Any] = {"request_timeout": self.timeout}
        if states:
            kwargs["states"] = {ConsumerGroupState[s.upper()] for s in states}
        if types:
            known = {t.upper() for t in types if t.upper() in ConsumerGroupType.__members__}
            if not known:
                raise UnsupportedFeature(
                    f"group type(s) {types} are not supported by confluent-kafka {_client_version()}"
                )
            kwargs["group_types"] = {ConsumerGroupType[t] for t in known}
        try:
            result = await self._resolve(self.admin.list_consumer_groups(**kwargs))
        except Exception as exc:
            if "group_types" in kwargs and "group_types" in str(exc):
                kwargs.pop("group_types")
                result = await self._resolve(self.admin.list_consumer_groups(**kwargs))
            else:
                raise
        out = []
        for g in result.valid:
            gtype = getattr(g, "type", None)
            out.append(
                {
                    "groupId": g.group_id,
                    "state": _enum_name(g.state).lower(),
                    "groupType": (_enum_name(gtype).lower() if gtype is not None else "classic"),
                    "isSimple": bool(g.is_simple_consumer_group),
                }
            )
        return sorted(out, key=lambda g: g["groupId"])

    async def describe_groups(self, group_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not group_ids:
            return {}
        futures = self.admin.describe_consumer_groups(group_ids, request_timeout=self.timeout)
        out: dict[str, dict[str, Any]] = {}
        for group_id, fut in futures.items():
            try:
                desc = await self._resolve(fut)
            except Exception as exc:
                out[group_id] = {"groupId": group_id, "error": str(exc), "state": "unknown", "members": []}
                continue
            out[group_id] = _group_to_dict(group_id, desc)
        return out

    async def group_offsets(self, group_id: str, topics: list[str] | None = None) -> list[dict[str, Any]]:
        from confluent_kafka import ConsumerGroupTopicPartitions, TopicPartition

        tps = [TopicPartition(t, -1) for t in topics] if topics else None
        request = ConsumerGroupTopicPartitions(group_id, tps)
        futures = self.admin.list_consumer_group_offsets([request], request_timeout=self.timeout)
        result = await self._resolve(next(iter(futures.values())))
        return [
            {"topic": tp.topic, "partition": tp.partition, "offset": tp.offset, "metadata": tp.metadata}
            for tp in (result.topic_partitions or [])
            if tp.offset >= 0
        ]

    async def alter_group_offsets(
        self, group_id: str, offsets: list[tuple[str, int, int]]
    ) -> list[dict[str, Any]]:
        from confluent_kafka import ConsumerGroupTopicPartitions, TopicPartition

        tps = [TopicPartition(t, p, o) for t, p, o in offsets]
        futures = self.admin.alter_consumer_group_offsets(
            [ConsumerGroupTopicPartitions(group_id, tps)], request_timeout=self.timeout
        )
        result = await self._resolve(next(iter(futures.values())))
        return [
            {
                "topic": tp.topic,
                "partition": tp.partition,
                "offset": tp.offset,
                "error": str(tp.error) if tp.error else None,
            }
            for tp in (result.topic_partitions or [])
        ]

    async def delete_groups(self, group_ids: list[str]) -> list[dict[str, Any]]:
        futures = self.admin.delete_consumer_groups(group_ids, request_timeout=self.timeout)
        out: list[dict[str, Any]] = []
        for group_id, fut in futures.items():
            try:
                await self._resolve(fut)
                out.append({"groupId": group_id, "deleted": True})
            except Exception as exc:
                out.append({"groupId": group_id, "deleted": False, "error": str(exc)})
        return out

    async def delete_group_offsets(self, group_id: str, topic: str) -> dict[str, Any]:
        """Kafka has no delete-offsets API in this client build; reset to ``-1`` instead."""
        if hasattr(self.admin, "delete_consumer_group_offsets"):
            from confluent_kafka import ConsumerGroupTopicPartitions, TopicPartition

            futures = self.admin.delete_consumer_group_offsets(  # type: ignore[attr-defined]
                ConsumerGroupTopicPartitions(group_id, [TopicPartition(topic, -1)]),
                request_timeout=self.timeout,
            )
            await self._resolve(next(iter(futures.values())) if isinstance(futures, dict) else futures)
            return {"groupId": group_id, "topic": topic, "deleted": True}
        current = await self.group_offsets(group_id, [topic])
        if not current:
            raise NotFound(f"group '{group_id}' has no committed offsets for topic '{topic}'")
        from confluent_kafka import OFFSET_INVALID

        await self.alter_group_offsets(group_id, [(topic, c["partition"], OFFSET_INVALID) for c in current])
        return {"groupId": group_id, "topic": topic, "deleted": True, "method": "alter-to-invalid"}


def _config_source_name(source: Any) -> str | None:
    """confluent-kafka returns either a ConfigSource enum or its raw int value."""
    if source is None:
        return None
    if hasattr(source, "name"):
        return str(source.name)
    try:
        from confluent_kafka.admin import ConfigSource

        return ConfigSource(int(source)).name
    except (ValueError, TypeError):
        return str(source)


def _enum_name(value: Any) -> str:
    return value.name if hasattr(value, "name") else str(value)


def _group_to_dict(group_id: str, desc: Any) -> dict[str, Any]:
    members = []
    for m in getattr(desc, "members", []) or []:
        assignment = getattr(m, "assignment", None)
        tps = getattr(assignment, "topic_partitions", []) if assignment else []
        members.append(
            {
                "memberId": m.member_id,
                "clientId": m.client_id,
                "host": m.host,
                "groupInstanceId": getattr(m, "group_instance_id", None),
                "assignments": [{"topic": tp.topic, "partition": tp.partition} for tp in tps],
            }
        )
    coordinator = getattr(desc, "coordinator", None)
    gtype = getattr(desc, "type", None)
    return {
        "groupId": group_id,
        "state": _enum_name(getattr(desc, "state", "unknown")).lower(),
        "groupType": _enum_name(gtype).lower() if gtype is not None else "classic",
        "protocolType": getattr(desc, "protocol_type", None) or None,
        "protocol": getattr(desc, "partition_assignor", None) or None,
        "coordinatorId": getattr(coordinator, "id", None),
        "isSimple": bool(getattr(desc, "is_simple_consumer_group", False)),
        "members": members,
    }


def _quorum_to_dict(result: Any) -> dict[str, Any]:
    def node(n: Any) -> dict[str, Any]:
        return {
            "id": getattr(n, "replica_id", getattr(n, "id", None)),
            "logEndOffset": getattr(n, "log_end_offset", None),
            "lastFetchTs": getattr(n, "last_fetch_timestamp", None),
            "lastCaughtUpTs": getattr(n, "last_caught_up_timestamp", None),
        }

    voters = [node(v) for v in getattr(result, "voters", []) or []]
    observers = [node(v) for v in getattr(result, "observers", []) or []]
    hwm = getattr(result, "high_watermark", None)
    for v in voters + observers:
        v["lag"] = (hwm - v["logEndOffset"]) if (hwm is not None and v["logEndOffset"] is not None) else None
    return {
        "supported": True,
        "leaderId": getattr(result, "leader_id", None),
        "leaderEpoch": getattr(result, "leader_epoch", None),
        "highWatermark": hwm,
        "voters": voters,
        "observers": observers,
    }


def _non_negative(value: Any) -> int | None:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


def _logdirs_to_dict(result: Any) -> dict[str, Any]:
    brokers: dict[str, Any] = {}
    for broker_id, dirs in (result or {}).items():
        entries = []
        for path, info in (dirs or {}).items():
            partitions = [
                {
                    "topic": getattr(tp, "topic", None),
                    "partition": getattr(tp, "partition", None),
                    "sizeBytes": getattr(meta, "size", None),
                    "offsetLag": getattr(meta, "offset_lag", None),
                }
                for tp, meta in (getattr(info, "replica_infos", {}) or {}).items()
            ]
            error = getattr(info, "error", None)
            entries.append(
                {
                    "path": path,
                    "sizeBytes": sum(p["sizeBytes"] or 0 for p in partitions),
                    # DescribeLogDirs v4+ (Kafka 3.3) reports capacity; older brokers/clients return -1.
                    "totalBytes": _non_negative(getattr(info, "total_bytes", None)),
                    "usableBytes": _non_negative(getattr(info, "usable_bytes", None)),
                    "error": str(error) if error else None,
                    "partitions": partitions,
                }
            )
        brokers[str(broker_id)] = entries
    return brokers


__all__ = ["KafkaAdmin", "client_config"]
