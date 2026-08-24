"""Serde round-trips: string, json, numeric, avro wire format, protobuf header, auto detection."""

from __future__ import annotations

import base64
import io
import json
from typing import Any

import fastavro
import pytest

from k_shui.kafka.serdes.auto import SerdeFactory
from k_shui.kafka.serdes.base import parse_wire_header, read_varint, wire_header, write_varint
from k_shui.kafka.serdes.protobuf import encode_message_indexes, parse_message_indexes

USER_SCHEMA = {
    "type": "record",
    "name": "User",
    "fields": [{"name": "id", "type": "int"}, {"name": "name", "type": "string"}],
}


class StubRegistry:
    """Minimal stand-in for :class:`SerdeRegistryClient`."""

    def __init__(self, schema: dict[str, Any], schema_id: int = 77, schema_type: str = "AVRO") -> None:
        self.schema = schema
        self.schema_id = schema_id
        self.schema_type = schema_type

    async def get_schema_by_id(self, schema_id: int) -> dict[str, Any]:
        return {
            "id": schema_id,
            "schema": json.dumps(self.schema),
            "schemaType": self.schema_type,
            "references": [],
        }

    async def get_latest(self, subject: str) -> dict[str, Any]:
        return {
            "id": self.schema_id,
            "subject": subject,
            "version": 1,
            "schema": json.dumps(self.schema),
            "schemaType": self.schema_type,
            "references": [],
        }

    async def subject_for(self, topic: str, is_key: bool) -> str:
        return f"{topic}-{'key' if is_key else 'value'}"


@pytest.fixture
def factory(settings: Any) -> SerdeFactory:
    from k_shui.core.registry import ClusterRegistry

    ctx = ClusterRegistry(settings).get("test")
    return SerdeFactory(ctx)


async def test_string_round_trip(factory: SerdeFactory) -> None:
    raw = await factory.serialize("string", "héllo", "t", False)
    value, fmt, schema_id = await factory.deserialize("string", raw, "t", False)
    assert (value, fmt, schema_id) == ("héllo", "string", None)


async def test_json_round_trip(factory: SerdeFactory) -> None:
    payload = {"a": 1, "b": ["x", None], "c": {"d": True}}
    raw = await factory.serialize("json", payload, "t", False)
    value, fmt, _ = await factory.deserialize("json", raw, "t", False)
    assert value == payload
    assert fmt == "json"


@pytest.mark.parametrize(("fmt", "value"), [("int", -42), ("long", 2**40), ("float", 1.5), ("double", 3.25)])
async def test_numeric_round_trip(factory: SerdeFactory, fmt: str, value: Any) -> None:
    raw = await factory.serialize(fmt, value, "t", True)
    decoded, out_fmt, _ = await factory.deserialize(fmt, raw, "t", True)
    assert decoded == value
    assert out_fmt == fmt


async def test_base64_and_hex_round_trip(factory: SerdeFactory) -> None:
    payload = b"\x00\x01\xff"
    for fmt in ("base64", "hex"):
        text, out_fmt, _ = await factory.deserialize(fmt, payload, "t", False)
        assert out_fmt == fmt
        assert await factory.serialize(fmt, text, "t", False) == payload


async def test_null_payload(factory: SerdeFactory) -> None:
    assert await factory.deserialize("string", None, "t", True) == (None, "null", None)


def test_wire_header_round_trip() -> None:
    assert parse_wire_header(wire_header(1234) + b"body") == (1234, b"body")
    assert parse_wire_header(b"plain json") is None
    assert parse_wire_header(b"") is None


def test_varint_round_trip() -> None:
    for n in (0, 1, -1, 63, 64, 300, -300):
        assert read_varint(write_varint(n), 0)[0] == n


def test_protobuf_message_indexes() -> None:
    assert parse_message_indexes(b"\x00rest") == ([0], b"rest")
    encoded = encode_message_indexes([1, 3])
    indexes, rest = parse_message_indexes(encoded + b"payload")
    assert indexes == [1, 3]
    assert rest == b"payload"
    assert encode_message_indexes([0]) == b"\x00"


async def test_avro_wire_format_round_trip(factory: SerdeFactory) -> None:
    factory.registry = StubRegistry(USER_SCHEMA)
    factory._cache.clear()
    record = {"id": 7, "name": "ada"}
    raw = await factory.serialize("avro", record, "users", False)
    assert raw[0] == 0
    assert int.from_bytes(raw[1:5], "big") == 77
    value, fmt, schema_id = await factory.deserialize("avro", raw, "users", False)
    assert value == record
    assert fmt == "avro"
    assert schema_id == 77


async def test_avro_decodes_externally_encoded_payload(factory: SerdeFactory) -> None:
    factory.registry = StubRegistry(USER_SCHEMA, schema_id=5)
    factory._cache.clear()
    buf = io.BytesIO()
    fastavro.schemaless_writer(buf, fastavro.parse_schema(USER_SCHEMA), {"id": 1, "name": "grace"})
    payload = wire_header(5) + buf.getvalue()
    value, fmt, schema_id = await factory.deserialize("avro", payload, "users", False)
    assert value == {"id": 1, "name": "grace"}
    assert (fmt, schema_id) == ("avro", 5)


async def test_auto_detects_registry_avro(factory: SerdeFactory) -> None:
    factory.registry = StubRegistry(USER_SCHEMA, schema_id=9)
    factory._cache.clear()
    raw = await factory.build("avro").serialize({"id": 3, "name": "lin"}, "users", False)
    value, fmt, schema_id = await factory.deserialize("auto", raw, "users", False)
    assert value == {"id": 3, "name": "lin"}
    assert (fmt, schema_id) == ("avro", 9)


async def test_auto_falls_back_to_json_then_string_then_base64(factory: SerdeFactory) -> None:
    value, fmt, _ = await factory.deserialize("auto", b'{"k": 1}', "t", False)
    assert (value, fmt) == ({"k": 1}, "json")

    value, fmt, _ = await factory.deserialize("auto", b"just text", "t", False)
    assert (value, fmt) == ("just text", "string")

    value, fmt, _ = await factory.deserialize("auto", b"\xff\xfe\xfd", "t", False)
    assert (value, fmt) == (base64.b64encode(b"\xff\xfe\xfd").decode(), "base64")


async def test_protobuf_unsupported_payload_is_reported_not_raised(factory: SerdeFactory) -> None:
    factory.registry = StubRegistry({"x": 1}, schema_id=12, schema_type="PROTOBUF")
    factory._cache.clear()
    payload = wire_header(12) + b"\x00" + b"\x08\x96\x01"
    value, fmt, schema_id = await factory.deserialize("protobuf", payload, "t", False)
    assert fmt == "protobuf"
    assert schema_id == 12
    assert value["_note"] == "protobuf decode unsupported"
    assert base64.b64decode(value["_raw"]) == b"\x08\x96\x01"


async def test_jsonschema_wire_format(factory: SerdeFactory) -> None:
    factory.registry = StubRegistry({"type": "object"}, schema_id=31, schema_type="JSON")
    factory._cache.clear()
    raw = await factory.serialize("jsonschema", {"ok": True}, "t", False)
    value, fmt, schema_id = await factory.deserialize("jsonschema", raw, "t", False)
    assert value == {"ok": True}
    assert (fmt, schema_id) == ("jsonschema", 31)


async def test_unknown_format_is_rejected(factory: SerdeFactory) -> None:
    from k_shui.core.errors import BadRequest

    with pytest.raises(BadRequest):
        factory.build("klingon")


async def test_deserialize_error_degrades_to_base64(factory: SerdeFactory) -> None:
    value, fmt, _ = await factory.deserialize("json", b"not json at all", "t", False)
    assert fmt == "base64"
    assert "_error" in value
