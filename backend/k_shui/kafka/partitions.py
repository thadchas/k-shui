"""Partition remediation: preferred/unclean leader election and replica reassignment.

Two layers live here:

* pure planning helpers (:func:`plan_reassignment`, :func:`reassignment_json`) that never
  touch a broker and are unit-tested in isolation;
* :class:`PartitionOps`, a thin adapter over :class:`~k_shui.kafka.admin.KafkaAdmin` that
  drives the ``AdminClient`` APIs and degrades to :class:`UnsupportedFeature` (HTTP 501)
  when the installed confluent-kafka build lacks one of them. With confluent-kafka 2.15
  ``elect_leaders`` exists; ``alter_partition_reassignments`` / ``list_partition_reassignments``
  do not, so reassignment ships as a plan + the equivalent ``kafka-reassign-partitions.sh``
  payload.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass, field
from itertools import zip_longest
from typing import Any

from k_shui.core.errors import BadRequest, NotFound
from k_shui.core.logging import get_logger
from k_shui.kafka.admin import UnsupportedFeature

log = get_logger(__name__)

REASSIGN_CLIENT_METHOD = "alter_partition_reassignments"
LIST_REASSIGN_CLIENT_METHOD = "list_partition_reassignments"
ELECT_CLIENT_METHOD = "elect_leaders"
THROTTLE_BROKER_KEYS = ("leader.replication.throttled.rate", "follower.replication.throttled.rate")
THROTTLE_TOPIC_KEYS = ("leader.replication.throttled.replicas", "follower.replication.throttled.replicas")


# ------------------------------------------------------------------ planning (pure)
@dataclass
class BrokerInfo:
    id: int
    rack: str | None = None


@dataclass
class PlanItem:
    topic: str
    partition: int
    current: list[int]
    proposed: list[int]

    @property
    def changed(self) -> bool:
        return self.current != self.proposed

    def as_dict(self) -> dict[str, Any]:
        return {
            "topic": self.topic,
            "partition": self.partition,
            "current": list(self.current),
            "proposed": list(self.proposed),
            "changed": self.changed,
        }


@dataclass
class Plan:
    items: list[PlanItem] = field(default_factory=list)
    brokers: list[int] = field(default_factory=list)
    rack_aware: bool = False

    @property
    def changed(self) -> list[PlanItem]:
        return [i for i in self.items if i.changed]


def rack_interleave(brokers: list[BrokerInfo]) -> list[BrokerInfo]:
    """Order brokers so that neighbours sit in different racks (Kafka's rack-alternated list).

    Brokers without a rack form their own pseudo-rack. When racks are unbalanced the longer
    racks simply keep going after the shorter ones run out.
    """
    by_rack: dict[str | None, list[BrokerInfo]] = defaultdict(list)
    for b in sorted(brokers, key=lambda b: b.id):
        by_rack[b.rack].append(b)
    lanes = [by_rack[r] for r in sorted(by_rack, key=lambda r: (r is None, str(r)))]
    out: list[BrokerInfo] = []
    for row in zip_longest(*lanes):
        out.extend(b for b in row if b is not None)
    return out


def assign_partition(
    ordered: list[int], start: int, rf: int, racks: dict[int, str | None] | None = None
) -> list[int]:
    """``rf`` distinct brokers starting at ``start`` on the (rack-interleaved) ring.

    With ``racks`` each next replica prefers a broker whose rack this partition does not use
    yet; once every rack is used the constraint resets, so an RF larger than the rack count
    still fills up (and unbalanced racks such as A=[1,2,3], B=[4] still span both racks).
    """
    n = len(ordered)
    ring = [ordered[(start + j) % n] for j in range(n)]
    if racks is None:
        return ring[:rf]
    chosen: list[int] = []
    used: set[str | None] = set()
    while len(chosen) < rf:
        pick = next((b for b in ring if b not in chosen and racks.get(b) not in used), None)
        if pick is None:  # every rack is represented → allow repeats, keep going round the ring
            used = set()
            continue
        chosen.append(pick)
        used.add(racks.get(pick))
    return chosen


def plan_reassignment(
    current: dict[str, dict[int, list[int]]],
    brokers: list[BrokerInfo],
    target_brokers: list[int] | None = None,
) -> Plan:
    """Propose a balanced assignment for ``current`` (topic -> partition -> replicas).

    * replication factor is preserved per partition;
    * the preferred leader (first replica) rotates so leadership spreads evenly;
    * when brokers carry racks, consecutive replicas land in different racks
      (as long as there are at least as many racks as the replication factor).
    """
    known = {b.id: b for b in brokers}
    if target_brokers:
        missing = sorted(set(target_brokers) - set(known))
        if missing:
            raise BadRequest(f"unknown broker id(s): {', '.join(map(str, missing))}")
        pool = [known[b] for b in sorted(set(target_brokers))]
    else:
        pool = sorted(brokers, key=lambda b: b.id)
    if not pool:
        raise BadRequest("no brokers available to place replicas on")

    rack_aware = any(b.rack for b in pool) and len({b.rack for b in pool}) > 1
    ordered = [b.id for b in (rack_interleave(pool) if rack_aware else pool)]
    racks = {b.id: b.rack for b in pool} if rack_aware else None
    n = len(ordered)

    plan = Plan(brokers=list(ordered), rack_aware=rack_aware)
    offset = 0  # keeps rotating across topics so small topics do not all lead on broker 0
    for topic in sorted(current):
        partitions = current[topic]
        for pid in sorted(partitions):
            replicas = list(partitions[pid])
            rf = len(replicas)
            if rf == 0:
                continue
            if rf > n:
                raise BadRequest(
                    f"topic '{topic}' has replication factor {rf} but only {n} broker(s) are eligible"
                )
            proposed = assign_partition(ordered, offset, rf, racks)
            plan.items.append(PlanItem(topic=topic, partition=pid, current=replicas, proposed=proposed))
            offset += 1
    return plan


def reassignment_json(items: list[PlanItem] | list[dict[str, Any]]) -> dict[str, Any]:
    """The ``kafka-reassign-partitions.sh --reassignment-json-file`` payload."""
    rows = []
    for item in items:
        if isinstance(item, PlanItem):
            rows.append({"topic": item.topic, "partition": item.partition, "replicas": list(item.proposed)})
        else:
            rows.append(
                {"topic": item["topic"], "partition": item["partition"], "replicas": list(item["replicas"])}
            )
    return {"version": 1, "partitions": rows}


def reassign_command(bootstrap: str, throttle: int | None = None) -> str:
    """The CLI equivalent. With a throttle the ``--verify`` pass is chained on, because that is
    what removes the throttle configs again once the move has finished."""
    base = (
        f"kafka-reassign-partitions.sh --bootstrap-server {bootstrap} "
        "--reassignment-json-file reassignment.json"
    )
    if not throttle:
        return f"{base} --execute"
    return f"{base} --throttle {throttle} --execute && {base} --verify"


# ------------------------------------------------------------------ admin adapter
def _error_text(exc: Any) -> str | None:
    if exc is None:
        return None
    err = getattr(exc, "args", [None])[0] if isinstance(exc, Exception) else exc
    for attr in ("str", "name"):
        fn = getattr(err, attr, None)
        if callable(fn):
            try:
                return str(fn())
            except Exception:  # pragma: no cover - defensive
                pass
    return str(exc)


def _error_code(exc: Any) -> str | None:
    err = getattr(exc, "args", [None])[0] if isinstance(exc, Exception) else exc
    fn = getattr(err, "name", None)
    if callable(fn):
        try:
            return str(fn())
        except Exception:  # pragma: no cover - defensive
            return None
    return None


class PartitionOps:
    """Partition-level admin operations bound to one cluster's :class:`KafkaAdmin`."""

    def __init__(self, admin: Any) -> None:
        self.admin = admin
        self.cluster_id = getattr(admin, "cluster_id", "?")
        self.timeout = float(getattr(admin, "timeout", 15.0))

    # ---------------------------------------------------------------- capability
    def _client(self) -> Any:
        return self.admin.admin

    def supports(self, method: str) -> bool:
        try:
            return callable(getattr(self._client(), method, None))
        except Exception:
            return False

    def capabilities(self) -> dict[str, Any]:
        from k_shui.kafka.admin import _client_version

        return {
            "clientVersion": _client_version(),
            "electLeaders": self.supports(ELECT_CLIENT_METHOD),
            "reassign": self.supports(REASSIGN_CLIENT_METHOD),
            "listReassignments": self.supports(LIST_REASSIGN_CLIENT_METHOD),
        }

    def _unsupported(self, method: str, feature: str, **extra: Any) -> UnsupportedFeature:
        from k_shui.kafka.admin import _client_version

        return UnsupportedFeature(
            f"{feature} is not available: confluent-kafka {_client_version()} has no "
            f"AdminClient.{method}; upgrade the client or run the equivalent CLI command.",
            **extra,
        )

    async def _wait(self, fut: Any) -> Any:
        """Block on a librdkafka future in a worker thread, translating errors like KafkaAdmin."""
        try:
            return await asyncio.to_thread(fut.result, self.timeout)
        except Exception as exc:
            translate = getattr(self.admin, "_translate", None)
            if callable(translate):
                raise translate(exc) from exc
            raise

    # ---------------------------------------------------------------- metadata helpers
    async def _current_assignment(self, topics: list[str] | None) -> dict[str, dict[int, list[int]]]:
        md = await self.admin.metadata(force=True)
        wanted = topics if topics else sorted(md.topics)
        out: dict[str, dict[int, list[int]]] = {}
        for name in wanted:
            topic = md.topics.get(name)
            if topic is None:
                raise NotFound(f"topic '{name}' not found")
            out[name] = {p.id: list(p.replicas) for p in topic.partitions.values()}
        return out

    async def _brokers(self) -> list[BrokerInfo]:
        info = await self.admin.describe_cluster()
        return [BrokerInfo(id=int(b["id"]), rack=b.get("rack")) for b in info.get("brokers", [])]

    async def _validate_partitions(self, partitions: list[tuple[str, int]]) -> None:
        if not partitions:
            return
        md = await self.admin.metadata(force=True)
        for topic, pid in partitions:
            t = md.topics.get(topic)
            if t is None:
                raise NotFound(f"topic '{topic}' not found")
            if pid not in t.partitions:
                raise NotFound(f"partition {pid} of topic '{topic}' not found")

    # ---------------------------------------------------------------- elections
    async def elect_leaders(self, partitions: list[tuple[str, int]], election_type: str) -> dict[str, Any]:
        """Run a preferred/unclean election; ``partitions=[]`` targets every partition."""
        if not self.supports(ELECT_CLIENT_METHOD):
            raise self._unsupported(ELECT_CLIENT_METHOD, "Leader election")
        await self._validate_partitions(partitions)

        from confluent_kafka import ElectionType, TopicPartition

        etype = ElectionType.UNCLEAN if election_type == "unclean" else ElectionType.PREFERRED
        targets = [TopicPartition(t, p) for t, p in partitions] or None
        # confluent-kafka 2.15 mis-parses kwargs for elect_leaders (SystemError: "more argument
        # specifiers than keyword list entries"), so the client default timeout is used.
        fut = self._client().elect_leaders(etype, targets)
        result = await self._wait(fut)
        items: list[dict[str, Any]] = []
        succeeded = failed = not_needed = 0
        for tp, err in (result or {}).items():
            code = _error_code(err)
            if err is None:
                status = "elected"
                succeeded += 1
            elif code and "ELECTION_NOT_NEEDED" in code:
                status = "notNeeded"
                not_needed += 1
            else:
                status = "failed"
                failed += 1
            items.append(
                {
                    "topic": tp.topic,
                    "partition": tp.partition,
                    "status": status,
                    "error": None if err is None else _error_text(err),
                }
            )
        items.sort(key=lambda i: (i["topic"], i["partition"]))
        cache = getattr(self.admin, "_cache", None)
        if cache is not None:
            cache.clear()
        return {
            "electionType": election_type,
            "items": items,
            "succeeded": succeeded,
            "failed": failed,
            "notNeeded": not_needed,
        }

    # ---------------------------------------------------------------- reassignment
    async def plan(self, topics: list[str], brokers: list[int] | None) -> dict[str, Any]:
        current = await self._current_assignment(topics)
        plan = plan_reassignment(current, await self._brokers(), brokers)
        return {
            "items": [i.as_dict() for i in plan.items],
            "changed": len(plan.changed),
            "brokers": plan.brokers,
            "rackAware": plan.rack_aware,
            "applySupported": self.supports(REASSIGN_CLIENT_METHOD),
            "reassignmentJson": reassignment_json(plan.changed),
            "command": reassign_command(self._bootstrap()),
        }

    def _bootstrap(self) -> str:
        ctx = getattr(self.admin, "ctx", None)
        cfg = getattr(ctx, "config", None)
        return str(getattr(cfg, "bootstrapServers", "<bootstrap>"))

    async def list_reassignments(self) -> dict[str, Any]:
        throttled = await self.is_throttled()
        if not self.supports(LIST_REASSIGN_CLIENT_METHOD):
            from k_shui.kafka.admin import _client_version

            return {
                "supported": False,
                "reason": (
                    f"confluent-kafka {_client_version()} has no AdminClient.{LIST_REASSIGN_CLIENT_METHOD}"
                ),
                "items": [],
                "throttled": throttled,
            }
        result = await self._wait(self._client().list_partition_reassignments(request_timeout=self.timeout))
        items = []
        for tp, info in (result or {}).items():
            items.append(
                {
                    "topic": tp.topic,
                    "partition": tp.partition,
                    "replicas": [int(r) for r in getattr(info, "replicas", [])],
                    "addingReplicas": [int(r) for r in getattr(info, "adding_replicas", [])],
                    "removingReplicas": [int(r) for r in getattr(info, "removing_replicas", [])],
                }
            )
        items.sort(key=lambda i: (i["topic"], i["partition"]))
        return {"supported": True, "reason": None, "items": items, "throttled": throttled}

    async def reassign(self, partitions: list[dict[str, Any]], throttle: int | None) -> dict[str, Any]:
        if not partitions:
            raise BadRequest("at least one partition is required")
        await self._validate_partitions([(p["topic"], int(p["partition"])) for p in partitions])
        known = {b.id for b in await self._brokers()}
        seen: set[tuple[str, int]] = set()
        for p in partitions:
            ref = (p["topic"], int(p["partition"]))
            if ref in seen:
                raise BadRequest(f"duplicate partition {p['topic']}-{p['partition']} in request")
            seen.add(ref)
            replicas = [int(r) for r in p["replicas"]]
            if len(set(replicas)) != len(replicas):
                raise BadRequest(f"duplicate replica for {p['topic']}-{p['partition']}")
            unknown = sorted(set(replicas) - known)
            if unknown:
                raise BadRequest(
                    f"unknown broker id(s) {', '.join(map(str, unknown))} for {p['topic']}-{p['partition']}"
                )
        payload = reassignment_json(partitions)
        if not self.supports(REASSIGN_CLIENT_METHOD):
            raise self._unsupported(
                REASSIGN_CLIENT_METHOD,
                "Partition reassignment",
                reassignmentJson=payload,
                command=reassign_command(self._bootstrap(), throttle),
            )

        from confluent_kafka import TopicPartition

        request = {
            TopicPartition(p["topic"], int(p["partition"])): [int(r) for r in p["replicas"]]
            for p in partitions
        }
        futures = self._client().alter_partition_reassignments(request, request_timeout=self.timeout)
        items = []
        for tp, fut in futures.items():
            error = None
            try:
                await self._wait(fut)
            except Exception as exc:  # per-partition failure; report, do not abort the batch
                error = str(exc)
            items.append(
                {"topic": tp.topic, "partition": tp.partition, "replicas": request[tp], "error": error}
            )
        items.sort(key=lambda i: (i["topic"], i["partition"]))
        cache = getattr(self.admin, "_cache", None)
        if cache is not None:
            cache.clear()
        accepted = [
            p
            for p in partitions
            if not any(
                i["error"]
                for i in items
                if i["topic"] == p["topic"] and i["partition"] == int(p["partition"])
            )
        ]
        # Only throttle once the controller accepted the move; a rejected batch must not leave
        # rate limits behind. Clearing is the caller's job (``clear_throttle`` / --verify).
        if throttle and accepted:
            await self._apply_throttle(accepted, throttle)
        return {
            "items": items,
            "throttleBytesPerSec": throttle if accepted else None,
            "reassignmentJson": payload,
        }

    async def _apply_throttle(self, partitions: list[dict[str, Any]], throttle: int) -> None:
        """Set broker rate throttles plus per-topic throttled-replica lists (like the CLI does)."""
        await self.admin.alter_configs("cluster", None, {k: str(throttle) for k in THROTTLE_BROKER_KEYS})
        current = await self._current_assignment(sorted({p["topic"] for p in partitions}))
        per_topic: dict[str, tuple[set[str], set[str]]] = defaultdict(lambda: (set(), set()))
        for p in partitions:
            topic, pid = p["topic"], int(p["partition"])
            before = set(current.get(topic, {}).get(pid, []))
            after = {int(r) for r in p["replicas"]}
            leaders, followers = per_topic[topic]
            leaders.update(f"{pid}:{b}" for b in before)  # every existing replica may serve as leader
            followers.update(f"{pid}:{b}" for b in after - before)
        for topic, (leaders, followers) in per_topic.items():
            await self.admin.alter_configs(
                "topic",
                topic,
                {
                    "leader.replication.throttled.replicas": ",".join(sorted(leaders)),
                    "follower.replication.throttled.replicas": ",".join(sorted(followers)),
                },
            )

    async def is_throttled(self) -> bool:
        """Any broker carrying a replication rate throttle (dynamic config)."""
        for broker in await self._brokers():
            try:
                entries = await self.admin.describe_configs("broker", str(broker.id))
            except Exception as exc:
                log.debug("partitions.throttle_probe_failed", broker=broker.id, error=str(exc))
                continue
            for e in entries:
                if e.get("name") in THROTTLE_BROKER_KEYS and e.get("value") not in (None, ""):
                    return True
        return False

    async def _throttled_topics(self) -> list[str]:
        """Topics that carry a throttled-replicas list; in-flight reassignment topics are checked
        first, then every topic (cheap enough: one describe per topic)."""
        md = await self.admin.metadata(force=True)
        found = []
        for name in sorted(md.topics):
            try:
                entries = await self.admin.describe_configs("topic", name)
            except Exception as exc:
                log.debug("partitions.throttle_probe_failed", topic=name, error=str(exc))
                continue
            if any(e.get("name") in THROTTLE_TOPIC_KEYS and e.get("value") for e in entries):
                found.append(name)
        return found

    async def clear_throttle(self, topics: list[str] | None) -> dict[str, Any]:
        """Remove the broker rate throttles and the per-topic throttled-replica lists.

        ``topics=None`` clears every topic that carries the config (what
        ``kafka-reassign-partitions.sh --verify`` does once a move has finished).
        """
        if topics:
            await self._validate_partitions([])
            md = await self.admin.metadata(force=True)
            missing = [t for t in topics if t not in md.topics]
            if missing:
                raise NotFound(f"topic '{missing[0]}' not found")
            targets = sorted(set(topics))
        else:
            targets = await self._throttled_topics()
        brokers = await self._brokers()
        await self.admin.alter_configs("cluster", None, dict.fromkeys(THROTTLE_BROKER_KEYS))
        for topic in targets:
            await self.admin.alter_configs("topic", topic, dict.fromkeys(THROTTLE_TOPIC_KEYS))
        cache = getattr(self.admin, "_cache", None)
        if cache is not None:
            cache.clear()
        return {"brokers": [b.id for b in brokers], "topics": targets}


__all__ = [
    "BrokerInfo",
    "PartitionOps",
    "Plan",
    "PlanItem",
    "assign_partition",
    "plan_reassignment",
    "rack_interleave",
    "reassign_command",
    "reassignment_json",
]
