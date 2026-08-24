"""Serialization/deserialization for Kafka keys and values."""

from k_shui.kafka.serdes.auto import AutoSerde, SerdeFactory
from k_shui.kafka.serdes.base import FORMATS, DeserializeError, Serde, parse_wire_header, wire_header
from k_shui.kafka.serdes.registry import SerdeRegistryClient

__all__ = [
    "FORMATS",
    "AutoSerde",
    "DeserializeError",
    "Serde",
    "SerdeFactory",
    "SerdeRegistryClient",
    "parse_wire_header",
    "wire_header",
]
