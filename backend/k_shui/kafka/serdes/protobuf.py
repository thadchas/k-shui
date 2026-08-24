"""Protobuf serde.

The Confluent wire format is fully parsed (magic byte, schema id, message-index varints).
Decoding the body requires compiling the registry's ``.proto`` source; when that is not
possible we return a structured placeholder instead of failing the whole message browse.
"""

from __future__ import annotations

import base64
from typing import Any

from k_shui.core.logging import get_logger
from k_shui.kafka.serdes.base import (
    DeserializeError,
    parse_wire_header,
    read_varint,
    wire_header,
    write_varint,
)
from k_shui.kafka.serdes.registry import SerdeRegistryClient

log = get_logger(__name__)


def parse_message_indexes(payload: bytes) -> tuple[list[int], bytes]:
    """Leading varint count then that many varints; a single ``0`` byte means ``[0]``."""
    if not payload:
        return [0], payload
    if payload[0] == 0:
        return [0], payload[1:]
    count, pos = read_varint(payload, 0)
    indexes: list[int] = []
    for _ in range(max(count, 0)):
        value, pos = read_varint(payload, pos)
        indexes.append(value)
    return indexes or [0], payload[pos:]


def encode_message_indexes(indexes: list[int]) -> bytes:
    if not indexes or indexes == [0]:
        return b"\x00"
    return write_varint(len(indexes)) + b"".join(write_varint(i) for i in indexes)


class ProtobufSerde:
    name = "protobuf"

    def __init__(self, registry: SerdeRegistryClient | None) -> None:
        self.registry = registry
        self._pools: dict[int, Any] = {}

    async def deserialize(
        self, data: bytes | None, topic: str = "", is_key: bool = False
    ) -> tuple[Any, str, int | None]:
        if data is None:
            return None, "null", None
        header = parse_wire_header(data)
        if header is None:
            raise DeserializeError("payload is not in confluent protobuf wire format (missing magic byte 0)")
        schema_id, rest = header
        indexes, body = parse_message_indexes(rest)
        decoded = await self._try_decode(schema_id, indexes, body)
        if decoded is not None:
            return decoded, "protobuf", schema_id
        return (
            {
                "_raw": base64.b64encode(body).decode("ascii"),
                "_schemaId": schema_id,
                "_messageIndexes": indexes,
                "_note": "protobuf decode unsupported",
            },
            "protobuf",
            schema_id,
        )

    async def _try_decode(self, schema_id: int, indexes: list[int], body: bytes) -> Any:
        """Decode when the registry serves a compiled FileDescriptorProto; else ``None``."""
        if self.registry is None:
            return None
        try:
            entry = await self.registry.get_schema_by_id(schema_id)
            schema = entry.get("schema") or ""
            if not schema or not schema.strip().startswith(("Cg", "Ct", "Cn")):
                return None  # textual .proto source — no parser available
            from google.protobuf import descriptor_pb2, descriptor_pool, message_factory

            fdp = descriptor_pb2.FileDescriptorProto()
            fdp.ParseFromString(base64.b64decode(schema))
            pool = self._pools.get(schema_id)
            if pool is None:
                pool = descriptor_pool.DescriptorPool()
                pool.Add(fdp)
                self._pools[schema_id] = pool
            index = indexes[0] if indexes else 0
            msg_name = f"{fdp.package + '.' if fdp.package else ''}{fdp.message_type[index].name}"
            descriptor = pool.FindMessageTypeByName(msg_name)
            message = message_factory.GetMessageClass(descriptor)()
            message.ParseFromString(body)
            from google.protobuf.json_format import MessageToDict

            return MessageToDict(message, preserving_proto_field_name=True)
        except Exception as exc:
            log.debug("protobuf.decode_failed", schema_id=schema_id, error=str(exc))
            return None

    async def serialize(
        self, value: Any, topic: str = "", is_key: bool = False, subject: str | None = None
    ) -> bytes | None:
        if value is None:
            return None
        if isinstance(value, str) and value.startswith("base64:"):
            body = base64.b64decode(value[7:])
        elif isinstance(value, (bytes, bytearray)):
            body = bytes(value)
        else:
            raise DeserializeError(
                "producing protobuf requires a pre-encoded payload (pass value as 'base64:<payload>')"
            )
        if self.registry is None:
            return body
        subject = subject or await self.registry.subject_for(topic, is_key)
        entry = await self.registry.get_latest(subject)
        return wire_header(int(entry["id"])) + encode_message_indexes([0]) + body
