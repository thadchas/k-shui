"""int / long / float / double / base64 / hex serdes."""

from __future__ import annotations

import base64
import struct
from typing import Any

from k_shui.kafka.serdes.base import DeserializeError

_STRUCTS = {"int": (">i", 4), "long": (">q", 8), "float": (">f", 4), "double": (">d", 8)}


class NumericSerde:
    def __init__(self, kind: str = "int") -> None:
        if kind not in _STRUCTS:
            raise ValueError(f"unsupported numeric kind '{kind}'")
        self.name = kind
        self._fmt, self._size = _STRUCTS[kind]

    async def deserialize(
        self, data: bytes | None, topic: str = "", is_key: bool = False
    ) -> tuple[Any, str, int | None]:
        if data is None:
            return None, "null", None
        if len(data) != self._size:
            raise DeserializeError(f"expected {self._size} bytes for {self.name}, got {len(data)}")
        return struct.unpack(self._fmt, data)[0], self.name, None

    async def serialize(
        self, value: Any, topic: str = "", is_key: bool = False, subject: str | None = None
    ) -> bytes | None:
        if value is None:
            return None
        number = float(value) if self.name in ("float", "double") else int(value)
        return struct.pack(self._fmt, number)


class Base64Serde:
    name = "base64"

    async def deserialize(
        self, data: bytes | None, topic: str = "", is_key: bool = False
    ) -> tuple[Any, str, int | None]:
        if data is None:
            return None, "null", None
        return base64.b64encode(data).decode("ascii"), "base64", None

    async def serialize(
        self, value: Any, topic: str = "", is_key: bool = False, subject: str | None = None
    ) -> bytes | None:
        if value is None:
            return None
        return base64.b64decode(value)


class HexSerde:
    name = "hex"

    async def deserialize(
        self, data: bytes | None, topic: str = "", is_key: bool = False
    ) -> tuple[Any, str, int | None]:
        if data is None:
            return None, "null", None
        return data.hex(), "hex", None

    async def serialize(
        self, value: Any, topic: str = "", is_key: bool = False, subject: str | None = None
    ) -> bytes | None:
        if value is None:
            return None
        return bytes.fromhex(str(value).replace(" ", ""))
