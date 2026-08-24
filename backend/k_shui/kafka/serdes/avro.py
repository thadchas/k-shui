"""Avro serde using fastavro over the Confluent wire format (magic byte 0 + 4-byte id)."""

from __future__ import annotations

import io
import json
from typing import Any

from k_shui.kafka.serdes.base import DeserializeError, parse_wire_header, wire_header
from k_shui.kafka.serdes.registry import SerdeRegistryClient


class AvroSerde:
    name = "avro"

    def __init__(self, registry: SerdeRegistryClient | None) -> None:
        self.registry = registry
        self._parsed: dict[int, Any] = {}

    async def _schema(self, schema_id: int) -> Any:
        import fastavro

        if schema_id in self._parsed:
            return self._parsed[schema_id]
        if self.registry is None:
            raise DeserializeError("no schema registry configured; cannot decode avro")
        entry = await self.registry.get_schema_by_id(schema_id)
        parsed = fastavro.parse_schema(json.loads(entry["schema"]))
        self._parsed[schema_id] = parsed
        return parsed

    async def deserialize(
        self, data: bytes | None, topic: str = "", is_key: bool = False
    ) -> tuple[Any, str, int | None]:
        if data is None:
            return None, "null", None
        header = parse_wire_header(data)
        if header is None:
            raise DeserializeError("payload is not in confluent avro wire format (missing magic byte 0)")
        schema_id, payload = header
        schema = await self._schema(schema_id)
        import fastavro

        try:
            value = fastavro.schemaless_reader(io.BytesIO(payload), schema)
        except Exception as exc:
            raise DeserializeError(f"avro decode failed for schema {schema_id}: {exc}") from exc
        return _jsonable(value), "avro", schema_id

    async def serialize(
        self, value: Any, topic: str = "", is_key: bool = False, subject: str | None = None
    ) -> bytes | None:
        if value is None:
            return None
        import fastavro

        if self.registry is None:
            raise DeserializeError("no schema registry configured; cannot encode avro")
        subject = subject or await self.registry.subject_for(topic, is_key)
        entry = await self.registry.get_latest(subject)
        schema = fastavro.parse_schema(json.loads(entry["schema"]))
        if isinstance(value, str):
            value = json.loads(value)
        buf = io.BytesIO()
        fastavro.schemaless_writer(buf, schema, value)
        return wire_header(int(entry["id"])) + buf.getvalue()


def _jsonable(value: Any) -> Any:
    """Make fastavro output JSON-serialisable (bytes, decimals, datetimes …)."""
    import datetime
    import decimal
    import uuid

    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, bytes):
        import base64

        return base64.b64encode(value).decode("ascii")
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value
