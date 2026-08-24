"""Format auto-detection plus the per-cluster serde factory."""

from __future__ import annotations

from typing import Any

import orjson

from k_shui.core.errors import BadRequest
from k_shui.core.registry import ClusterContext
from k_shui.kafka.serdes.avro import AvroSerde
from k_shui.kafka.serdes.base import FORMATS, DeserializeError, parse_wire_header
from k_shui.kafka.serdes.json import JsonSerde
from k_shui.kafka.serdes.jsonschema import JsonSchemaSerde
from k_shui.kafka.serdes.numeric import Base64Serde, HexSerde, NumericSerde
from k_shui.kafka.serdes.protobuf import ProtobufSerde
from k_shui.kafka.serdes.registry import SerdeRegistryClient
from k_shui.kafka.serdes.string import StringSerde


class AutoSerde:
    """magic byte 0 → registry (avro/protobuf/jsonschema by schemaType); else JSON; else string."""

    name = "auto"

    def __init__(self, factory: SerdeFactory) -> None:
        self.factory = factory

    async def deserialize(
        self, data: bytes | None, topic: str = "", is_key: bool = False
    ) -> tuple[Any, str, int | None]:
        if data is None:
            return None, "null", None
        header = parse_wire_header(data)
        if header is not None:
            schema_id, _payload = header
            serde = await self.factory.for_schema_id(schema_id)
            if serde is not None:
                try:
                    return await serde.deserialize(data, topic, is_key)
                except DeserializeError:
                    pass
        try:
            return orjson.loads(data), "json", None
        except orjson.JSONDecodeError:
            pass
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            import base64

            return base64.b64encode(data).decode("ascii"), "base64", None
        return text, "string", None

    async def serialize(
        self, value: Any, topic: str = "", is_key: bool = False, subject: str | None = None
    ) -> bytes | None:
        if value is None:
            return None
        if isinstance(value, (dict, list)):
            return orjson.dumps(value)
        return str(value).encode("utf-8")


class SerdeFactory:
    """Builds and caches serdes for one cluster."""

    def __init__(self, ctx: ClusterContext) -> None:
        self.ctx = ctx
        self.registry = SerdeRegistryClient.get(ctx)
        self._cache: dict[str, Any] = {}

    @classmethod
    def from_context(cls, ctx: ClusterContext) -> SerdeFactory:
        return cls(ctx)

    @staticmethod
    def get(ctx: ClusterContext) -> SerdeFactory:
        return ctx.client("serdes", SerdeFactory.from_context)

    def build(self, fmt: str) -> Any:
        fmt = (fmt or "auto").lower()
        if fmt not in FORMATS:
            raise BadRequest(f"unknown format '{fmt}'; allowed: {list(FORMATS)}")
        if fmt in self._cache:
            return self._cache[fmt]
        serde: Any
        if fmt == "auto":
            serde = AutoSerde(self)
        elif fmt == "string":
            serde = StringSerde()
        elif fmt == "json":
            serde = JsonSerde()
        elif fmt == "avro":
            serde = AvroSerde(self.registry)
        elif fmt == "protobuf":
            serde = ProtobufSerde(self.registry)
        elif fmt == "jsonschema":
            serde = JsonSchemaSerde(self.registry)
        elif fmt == "base64":
            serde = Base64Serde()
        elif fmt == "hex":
            serde = HexSerde()
        elif fmt == "null":
            serde = StringSerde()
        else:
            serde = NumericSerde(fmt)
        self._cache[fmt] = serde
        return serde

    async def for_schema_id(self, schema_id: int) -> Any | None:
        """Pick the right registry-backed serde for a wire-format schema id."""
        if self.registry is None:
            return None
        try:
            entry = await self.registry.get_schema_by_id(schema_id)
        except Exception:
            return None
        schema_type = (entry.get("schemaType") or "AVRO").upper()
        return self.build(
            {"AVRO": "avro", "PROTOBUF": "protobuf", "JSON": "jsonschema"}.get(schema_type, "avro")
        )

    async def deserialize(
        self, fmt: str, data: bytes | None, topic: str, is_key: bool
    ) -> tuple[Any, str, int | None]:
        serde = self.build(fmt)
        try:
            return await serde.deserialize(data, topic, is_key)
        except DeserializeError as exc:
            import base64

            return (
                {"_error": str(exc), "_raw": base64.b64encode(data or b"").decode("ascii")},
                "base64",
                None,
            )

    async def serialize(
        self, fmt: str, value: Any, topic: str, is_key: bool, subject: str | None = None
    ) -> bytes | None:
        return await self.build(fmt).serialize(value, topic, is_key, subject)


__all__ = ["AutoSerde", "SerdeFactory"]
