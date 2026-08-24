"""In-memory Kafka doubles injected through ``ClusterContext.client`` factories."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from k_shui.core.errors import Conflict, NotFound


@dataclass
class FakePartition:
    id: int
    leader: int = 0
    replicas: list[int] = field(default_factory=lambda: [0])
    isrs: list[int] = field(default_factory=lambda: [0])
    begin: int = 0
    end: int = 10


@dataclass
class FakeTopic:
    name: str
    partitions: dict[int, FakePartition]
    configs: dict[str, str] = field(default_factory=dict)

    @property
    def error(self) -> None:
        return None


@dataclass
class FakeBroker:
    id: int
    host: str = "broker-0"
    port: int = 9092
    rack: str | None = "rack-a"


class FakeMetadata:
    def __init__(self, topics: dict[str, FakeTopic], brokers: dict[int, FakeBroker]) -> None:
        self.topics = topics
        self.brokers = brokers
        self.controller_id = min(brokers) if brokers else -1
        self.cluster_id = "fake-cluster-id"


def _topic(name: str, partitions: int = 2, end: int = 10, configs: dict[str, str] | None = None) -> FakeTopic:
    return FakeTopic(
        name=name,
        partitions={i: FakePartition(id=i, end=end) for i in range(partitions)},
        configs=configs or {"cleanup.policy": "delete", "retention.ms": "604800000"},
    )


class FakeKafkaAdmin:
    """Mirrors the public surface of :class:`k_shui.kafka.admin.KafkaAdmin`."""

    def __init__(self, ctx: Any, timeout: float = 5.0) -> None:
        self.ctx = ctx
        self.cluster_id = ctx.config.id
        self.timeout = timeout
        self.reachable = True
        self.topics: dict[str, FakeTopic] = {
            "orders": _topic("orders", 3, 100),
            "events": _topic("events", 1, 5, {"cleanup.policy": "compact", "retention.ms": "-1"}),
            "__consumer_offsets": _topic("__consumer_offsets", 1, 0),
        }
        self.brokers: dict[int, FakeBroker] = {0: FakeBroker(0), 1: FakeBroker(1, "broker-1", 9093, None)}
        self.groups: dict[str, dict[str, Any]] = {
            "app-consumers": {
                "state": "stable",
                "groupType": "classic",
                "protocolType": "consumer",
                "protocol": "range",
                "coordinatorId": 0,
                "isSimple": False,
                "members": [
                    {
                        "memberId": "m-1",
                        "clientId": "client-1",
                        "host": "/10.0.0.1",
                        "groupInstanceId": None,
                        "assignments": [{"topic": "orders", "partition": 0}],
                    }
                ],
                "offsets": [{"topic": "orders", "partition": 0, "offset": 90, "metadata": ""}],
            }
        }
        self.acls: list[dict[str, Any]] = []
        self.scram: dict[str, list[dict[str, Any]]] = {}
        self.calls: list[str] = []

    # ------------------------------------------------------------- helpers
    def _record(self, name: str) -> None:
        self.calls.append(name)

    def _require_topic(self, name: str) -> FakeTopic:
        if name not in self.topics:
            raise NotFound(f"topic '{name}' not found")
        return self.topics[name]

    @classmethod
    def factory(cls, ctx: Any) -> FakeKafkaAdmin:
        return cls(ctx)

    async def close(self) -> None:
        self._record("close")

    async def ping(self) -> bool:
        if not self.reachable:
            raise ConnectionError("cluster unreachable")
        return True

    # ------------------------------------------------------------- metadata
    async def metadata(self, topic: str | None = None, force: bool = False) -> FakeMetadata:
        await self.ping()
        return FakeMetadata(self.topics, self.brokers)

    async def describe_cluster(self) -> dict[str, Any]:
        await self.ping()
        return {
            "clusterId": "fake-cluster-id",
            "controllerId": 0,
            "brokers": [
                {"id": b.id, "host": b.host, "port": b.port, "rack": b.rack} for b in self.brokers.values()
            ],
            "brokerCount": len(self.brokers),
            "topicCount": len(self.topics),
            "partitionCount": sum(len(t.partitions) for t in self.topics.values()),
            "listeners": [f"{b.host}:{b.port}" for b in self.brokers.values()],
        }

    async def broker_version(self) -> str | None:
        return "3.9"

    async def kraft_quorum(self) -> dict[str, Any]:
        return {
            "supported": True,
            "leaderId": 0,
            "leaderEpoch": 4,
            "highWatermark": 1200,
            "voters": [
                {"id": 0, "logEndOffset": 1200, "lastFetchTs": None, "lastCaughtUpTs": None, "lag": 0}
            ],
            "observers": [],
        }

    # ------------------------------------------------------------- topics
    async def list_topics(self, include_internal: bool = True) -> list[dict[str, Any]]:
        await self.ping()
        out = []
        for name, t in self.topics.items():
            internal = name.startswith("__")
            if not include_internal and internal:
                continue
            out.append(
                {
                    "name": name,
                    "partitions": len(t.partitions),
                    "replicationFactor": 1,
                    "isInternal": internal,
                    "underReplicatedPartitions": 0,
                    "offlinePartitions": 0,
                    "error": None,
                }
            )
        return sorted(out, key=lambda t: t["name"])

    async def describe_topic(self, topic: str) -> dict[str, Any]:
        t = self._require_topic(topic)
        return {
            "name": topic,
            "isInternal": topic.startswith("__"),
            "partitions": len(t.partitions),
            "replicationFactor": 1,
            "partitionsDetail": [
                {
                    "id": p.id,
                    "leader": p.leader,
                    "replicas": list(p.replicas),
                    "isr": list(p.isrs),
                    "underReplicated": False,
                    "offline": False,
                }
                for p in sorted(t.partitions.values(), key=lambda p: p.id)
            ],
        }

    async def create_topic(
        self,
        name: str,
        partitions: int = 1,
        replication_factor: int = -1,
        configs: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        self._record(f"create_topic:{name}")
        if name in self.topics:
            raise Conflict(f"topic '{name}' already exists")
        self.topics[name] = _topic(name, partitions, 0, {**(configs or {}), "cleanup.policy": "delete"})
        return {"name": name, "partitions": partitions, "replicationFactor": replication_factor}

    async def delete_topic(self, name: str) -> None:
        self._record(f"delete_topic:{name}")
        self._require_topic(name)
        del self.topics[name]

    async def create_partitions(self, topic: str, total_count: int) -> dict[str, Any]:
        t = self._require_topic(topic)
        for i in range(len(t.partitions), total_count):
            t.partitions[i] = FakePartition(id=i, end=0)
        return {"name": topic, "partitions": total_count}

    async def delete_records(self, offsets: list[tuple[str, int, int]]) -> list[dict[str, Any]]:
        out = []
        for name, part, before in offsets:
            p = self._require_topic(name).partitions[part]
            p.begin = p.end if before < 0 else min(max(before, p.begin), p.end)
            out.append({"topic": name, "partition": part, "lowWatermark": p.begin})
        return out

    # ------------------------------------------------------------- offsets
    async def watermarks(self, partitions: list[tuple[str, int]]) -> dict[tuple[str, int], tuple[int, int]]:
        out: dict[tuple[str, int], tuple[int, int]] = {}
        for name, part in partitions:
            t = self.topics.get(name)
            p = t.partitions.get(part) if t else None
            out[(name, part)] = (p.begin, p.end) if p else (0, 0)
        return out

    async def offsets_for_times(self, partitions: list[tuple[str, int, int]]) -> dict[tuple[str, int], int]:
        return {(name, part): 5 for name, part, _ts in partitions}

    # ------------------------------------------------------------- configs
    async def describe_configs(self, kind: str, name: str | None = None) -> list[dict[str, Any]]:
        if kind == "topic":
            source = self._require_topic(str(name)).configs
        elif kind == "cluster":
            source = {"min.insync.replicas": "1"}
        else:
            if int(name or 0) not in self.brokers:
                raise NotFound(f"broker {name} not found")
            source = {"log.dirs": "/var/lib/kafka", "num.io.threads": "8"}
        return [
            {
                "name": k,
                "value": v,
                "source": "DYNAMIC_TOPIC_CONFIG" if kind == "topic" else "DYNAMIC_BROKER_CONFIG",
                "isDefault": False,
                "isReadOnly": False,
                "isSensitive": False,
                "documentation": None,
                "synonyms": [],
            }
            for k, v in sorted(source.items())
        ]

    async def alter_configs(
        self, kind: str, name: str | None, configs: dict[str, Any]
    ) -> list[dict[str, Any]]:
        self._record(f"alter_configs:{kind}:{name}")
        if kind == "topic":
            self._require_topic(str(name)).configs.update(
                {k: str(v) for k, v in configs.items() if v is not None}
            )
        return await self.describe_configs(kind, name)

    async def describe_log_dirs(self, broker_ids: list[int] | None = None) -> dict[str, Any]:
        return {
            "supported": True,
            "brokers": {
                str(b): [
                    {
                        "path": "/var/lib/kafka",
                        "sizeBytes": 1024,
                        "partitions": [
                            {"topic": "orders", "partition": 0, "sizeBytes": 1024, "offsetLag": 0}
                        ],
                    }
                ]
                for b in self.brokers
                if not broker_ids or b in broker_ids
            },
        }

    # ------------------------------------------------------------- groups
    async def list_groups(
        self, states: list[str] | None = None, types: list[str] | None = None
    ) -> list[dict[str, Any]]:
        from k_shui.kafka.admin import UnsupportedFeature

        if types and "share" in types:
            raise UnsupportedFeature("share groups are not supported")
        return [
            {"groupId": g, "state": v["state"], "groupType": v["groupType"], "isSimple": v["isSimple"]}
            for g, v in sorted(self.groups.items())
        ]

    async def describe_groups(self, group_ids: list[str]) -> dict[str, dict[str, Any]]:
        out = {}
        for g in group_ids:
            v = self.groups.get(g)
            if v is None:
                out[g] = {"groupId": g, "error": "not found", "state": "unknown", "members": []}
                continue
            out[g] = {"groupId": g, **{k: v[k] for k in v if k != "offsets"}}
        return out

    async def group_offsets(self, group_id: str, topics: list[str] | None = None) -> list[dict[str, Any]]:
        v = self.groups.get(group_id)
        if v is None:
            return []
        return [o for o in v["offsets"] if not topics or o["topic"] in topics]

    async def alter_group_offsets(
        self, group_id: str, offsets: list[tuple[str, int, int]]
    ) -> list[dict[str, Any]]:
        self._record(f"alter_group_offsets:{group_id}")
        committed = {(o["topic"], o["partition"]): o for o in self.groups[group_id]["offsets"]}
        out = []
        for name, part, offset in offsets:
            if (name, part) in committed:
                committed[(name, part)]["offset"] = offset
            out.append({"topic": name, "partition": part, "offset": offset, "error": None})
        return out

    async def delete_groups(self, group_ids: list[str]) -> list[dict[str, Any]]:
        out = []
        for g in group_ids:
            if g in self.groups:
                del self.groups[g]
                out.append({"groupId": g, "deleted": True})
            else:
                out.append({"groupId": g, "deleted": False, "error": "not found"})
        return out

    async def delete_group_offsets(self, group_id: str, topic: str) -> dict[str, Any]:
        if group_id not in self.groups:
            raise NotFound(f"group '{group_id}' not found")
        self.groups[group_id]["offsets"] = [
            o for o in self.groups[group_id]["offsets"] if o["topic"] != topic
        ]
        return {"groupId": group_id, "topic": topic, "deleted": True}

    # ------------------------------------------------------------- security
    async def describe_acls(self, **filters: Any) -> list[dict[str, Any]]:
        return list(self.acls)

    async def create_acls(self, specs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        self.acls.extend(specs)
        return [{**s, "created": True} for s in specs]

    async def delete_acls(self, **filters: Any) -> list[dict[str, Any]]:
        removed, self.acls = self.acls, []
        return removed

    async def describe_quotas(
        self, entity_type: str | None = None, entity_name: str | None = None
    ) -> dict[str, Any]:
        return {"supported": False, "items": [], "reason": "not supported by the fake"}

    async def alter_quotas(
        self, entity_type: str, entity_name: str | None, quotas: dict[str, Any]
    ) -> dict[str, Any]:
        return {"supported": False, "reason": "not supported by the fake"}

    async def describe_scram_users(self, users: list[str] | None = None) -> list[dict[str, Any]]:
        return [{"username": u, "credentials": c} for u, c in sorted(self.scram.items())]

    async def upsert_scram_user(
        self, username: str, password: str, mechanism: str = "SCRAM_SHA_512", iterations: int = 4096
    ) -> dict[str, Any]:
        self.scram[username] = [{"mechanism": mechanism, "iterations": iterations}]
        return {"username": username, "ok": True}

    async def delete_scram_user(self, username: str, mechanism: str = "SCRAM_SHA_512") -> dict[str, Any]:
        self.scram.pop(username, None)
        return {"username": username, "ok": True}


class FakeMessageBrowser:
    """Yields deterministic browse events without touching a broker."""

    def __init__(self, ctx: Any) -> None:
        self.ctx = ctx
        self.admin = FakeKafkaAdmin(ctx)

    @classmethod
    def factory(cls, ctx: Any) -> FakeMessageBrowser:
        return cls(ctx)

    def _messages(self, req: Any) -> list[dict[str, Any]]:
        return [
            {
                "partition": i % 2,
                "offset": 90 + i,
                "timestamp": 1700000000000 + i,
                "timestampType": "createTime",
                "key": f"key-{i}",
                "keyFormat": "string",
                "value": {"n": i, "topic": req.topic},
                "valueFormat": "json",
                "headers": {"trace": f"t{i}"},
                "keySchemaId": None,
                "valueSchemaId": None,
                "sizeBytes": 42,
            }
            for i in range(min(req.limit, 3))
        ]

    async def browse(self, req: Any):
        messages = self._messages(req)
        for m in messages:
            yield {"type": "message", "message": m}
        yield {"type": "progress", "scanned": len(messages), "matched": len(messages), "done": False}
        yield {
            "type": "end",
            "scanned": len(messages),
            "matched": len(messages),
            "truncated": False,
            "assignments": [],
        }

    async def collect(self, req: Any) -> dict[str, Any]:
        messages = self._messages(req)
        return {
            "items": messages,
            "scanned": len(messages),
            "matched": len(messages),
            "truncated": False,
            "assignments": [],
        }


class FakeProducer:
    def __init__(self, ctx: Any) -> None:
        self.ctx = ctx
        self.produced: list[dict[str, Any]] = []

    @classmethod
    def factory(cls, ctx: Any) -> FakeProducer:
        return cls(ctx)

    async def produce(self, topic: str, value: Any, **kwargs: Any) -> dict[str, Any]:
        self.produced.append({"topic": topic, "value": value, **kwargs})
        return {
            "partition": kwargs.get("partition") or 0,
            "offset": len(self.produced),
            "timestamp": 1700000000000,
        }

    def close(self) -> None:
        return None


__all__ = ["FakeKafkaAdmin", "FakeMessageBrowser", "FakeProducer"]
