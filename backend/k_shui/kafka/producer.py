"""Producing messages from the UI (headers, explicit partition, serde-encoded key/value)."""

from __future__ import annotations

import asyncio
import threading
from typing import Any

from k_shui.core.errors import UpstreamError
from k_shui.core.logging import get_logger
from k_shui.core.registry import ClusterContext
from k_shui.kafka.admin import client_config
from k_shui.kafka.serdes.auto import SerdeFactory

log = get_logger(__name__)

PRODUCE_TIMEOUT = 15.0


class MessageProducer:
    def __init__(self, ctx: ClusterContext) -> None:
        self.ctx = ctx
        self.serdes = SerdeFactory.get(ctx)
        self._producer: Any = None
        self._lock = threading.Lock()

    @classmethod
    def from_context(cls, ctx: ClusterContext) -> MessageProducer:
        return cls(ctx)

    @staticmethod
    def get(ctx: ClusterContext) -> MessageProducer:
        return ctx.client("producer", MessageProducer.from_context)

    @property
    def producer(self) -> Any:
        with self._lock:
            if self._producer is None:
                from confluent_kafka import Producer

                self._producer = Producer(client_config(self.ctx, {"linger.ms": 5}))
            return self._producer

    def close(self) -> None:
        if self._producer is not None:
            self._producer.flush(5)
            self._producer = None

    async def produce(
        self,
        topic: str,
        value: Any,
        key: Any = None,
        headers: dict[str, Any] | None = None,
        partition: int | None = None,
        key_format: str = "string",
        value_format: str = "json",
        key_subject: str | None = None,
        value_subject: str | None = None,
    ) -> dict[str, Any]:
        key_bytes = await self.serdes.serialize(key_format, key, topic, True, key_subject)
        value_bytes = await self.serdes.serialize(value_format, value, topic, False, value_subject)
        header_list = [(k, str(v).encode("utf-8")) for k, v in (headers or {}).items()]
        producer = self.producer  # built on the loop thread on purpose
        return await asyncio.to_thread(
            self._produce_sync, producer, topic, key_bytes, value_bytes, header_list, partition
        )

    def _produce_sync(
        self,
        producer: Any,
        topic: str,
        key: bytes | None,
        value: bytes | None,
        headers: list[tuple[str, bytes]],
        partition: int | None,
    ) -> dict[str, Any]:
        from confluent_kafka import KafkaException

        done = threading.Event()
        result: dict[str, Any] = {}

        def callback(err: Any, msg: Any) -> None:
            if err is not None:
                result["error"] = str(err)
            else:
                result.update(
                    {"partition": msg.partition(), "offset": msg.offset(), "timestamp": msg.timestamp()[1]}
                )
            done.set()

        kwargs: dict[str, Any] = {"value": value, "key": key, "on_delivery": callback}
        if headers:
            kwargs["headers"] = headers
        if partition is not None and partition >= 0:
            kwargs["partition"] = partition
        try:
            producer.produce(topic, **kwargs)
            producer.flush(PRODUCE_TIMEOUT)
        except KafkaException as exc:
            raise UpstreamError(f"produce failed: {exc}") from exc
        if not done.wait(PRODUCE_TIMEOUT):
            raise UpstreamError("produce timed out waiting for delivery report")
        if "error" in result:
            raise UpstreamError(f"produce failed: {result['error']}")
        return result


__all__ = ["MessageProducer"]
