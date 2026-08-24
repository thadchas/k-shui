"""Serde protocol shared by every format handler."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

MAGIC_BYTE = 0
FORMATS = (
    "auto",
    "string",
    "json",
    "avro",
    "protobuf",
    "jsonschema",
    "base64",
    "hex",
    "int",
    "long",
    "float",
    "double",
    "null",
)


class DeserializeError(Exception):
    """Raised when a payload cannot be decoded with the requested format."""


@runtime_checkable
class Serde(Protocol):
    name: str

    async def deserialize(
        self, data: bytes | None, topic: str = "", is_key: bool = False
    ) -> tuple[Any, str, int | None]:
        """Return ``(value, format, schemaId)``."""
        ...

    async def serialize(
        self, value: Any, topic: str = "", is_key: bool = False, subject: str | None = None
    ) -> bytes | None: ...


def parse_wire_header(data: bytes) -> tuple[int, bytes] | None:
    """Confluent wire format: magic byte 0 + big-endian 4-byte schema id. → (schemaId, payload)."""
    if not data or len(data) < 5 or data[0] != MAGIC_BYTE:
        return None
    schema_id = int.from_bytes(data[1:5], "big")
    return schema_id, data[5:]


def wire_header(schema_id: int) -> bytes:
    return bytes([MAGIC_BYTE]) + schema_id.to_bytes(4, "big")


def read_varint(data: bytes, pos: int) -> tuple[int, int]:
    """Zig-zag decoded base-128 varint (protobuf message-index encoding). → (value, newPos)."""
    result = shift = 0
    while pos < len(data):
        b = data[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            break
        shift += 7
    return (result >> 1) ^ -(result & 1), pos


def write_varint(value: int) -> bytes:
    zig = (value << 1) ^ (value >> 63)
    out = bytearray()
    while True:
        bits = zig & 0x7F
        zig >>= 7
        if zig:
            out.append(bits | 0x80)
        else:
            out.append(bits)
            return bytes(out)


__all__ = [
    "FORMATS",
    "MAGIC_BYTE",
    "DeserializeError",
    "Serde",
    "parse_wire_header",
    "read_varint",
    "wire_header",
    "write_varint",
]
