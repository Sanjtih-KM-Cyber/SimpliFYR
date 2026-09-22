from __future__ import annotations

from dataclasses import dataclass, field

# A value transformation maps a source value to a normalized value. `None` means
# pass-through (identity). A dict uses exact lookup; an optional "_default" key is
# used when the source value has no explicit entry.
Transformation = dict[str, str] | None


@dataclass
class FieldMapping:
    """Maps one source field to one semantic field."""

    input_field: str
    semantic_field: str
    transformation: Transformation = None
    confidence: float = 1.0


@dataclass
class Mapping:
    """An ordered set of field mappings representing one source/version/event family."""

    name: str
    fields: list[FieldMapping] = field(default_factory=list)
    version: int = 1
    source: str | None = None
    event_family: str | None = None

    def add(self, field_mapping: FieldMapping) -> None:
        self.fields.append(field_mapping)