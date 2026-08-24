"""UTF-8 string serde."""

from __future__ import annotations

from typing import Any


class StringSerde:
    name = "string"

    async def deserialize(
        self, data: bytes | None, topic: str = "", is_key: bool = False
    ) -> tuple[Any, str, int | None]:
        if data is None:
            return None, "null", None
        return data.decode("utf-8", errors="replace"), "string", None

    async def serialize(
        self, value: Any, topic: str = "", is_key: bool = False, subject: str | None = None
    ) -> bytes | None:
        if value is None:
            return None
        return value.encode("utf-8") if isinstance(value, str) else str(value).encode("utf-8")
