"""Plain JSON serde (no schema registry involved)."""

from __future__ import annotations

from typing import Any

import orjson

from k_shui.kafka.serdes.base import DeserializeError


class JsonSerde:
    name = "json"

    async def deserialize(
        self, data: bytes | None, topic: str = "", is_key: bool = False
    ) -> tuple[Any, str, int | None]:
        if data is None:
            return None, "null", None
        try:
            return orjson.loads(data), "json", None
        except orjson.JSONDecodeError as exc:
            raise DeserializeError(f"not valid JSON: {exc}") from exc

    async def serialize(
        self, value: Any, topic: str = "", is_key: bool = False, subject: str | None = None
    ) -> bytes | None:
        if value is None:
            return None
        if isinstance(value, str):
            try:
                value = orjson.loads(value)
            except orjson.JSONDecodeError:
                return value.encode("utf-8")
        return orjson.dumps(value)
