"""JSON Schema serde: Confluent wire format wrapping a plain JSON document."""

from __future__ import annotations

from typing import Any

import orjson

from k_shui.kafka.serdes.base import DeserializeError, parse_wire_header, wire_header
from k_shui.kafka.serdes.registry import SerdeRegistryClient


class JsonSchemaSerde:
    name = "jsonschema"

    def __init__(self, registry: SerdeRegistryClient | None) -> None:
        self.registry = registry

    async def deserialize(
        self, data: bytes | None, topic: str = "", is_key: bool = False
    ) -> tuple[Any, str, int | None]:
        if data is None:
            return None, "null", None
        header = parse_wire_header(data)
        payload, schema_id = (header[1], header[0]) if header else (data, None)
        try:
            return orjson.loads(payload), "jsonschema", schema_id
        except orjson.JSONDecodeError as exc:
            raise DeserializeError(f"jsonschema payload is not valid JSON: {exc}") from exc

    async def serialize(
        self, value: Any, topic: str = "", is_key: bool = False, subject: str | None = None
    ) -> bytes | None:
        if value is None:
            return None
        if isinstance(value, str):
            value = orjson.loads(value)
        body = orjson.dumps(value)
        if self.registry is None:
            return body
        subject = subject or await self.registry.subject_for(topic, is_key)
        entry = await self.registry.get_latest(subject)
        return wire_header(int(entry["id"])) + body
