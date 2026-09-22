from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class OutputField:
    """Selects one semantic field and places it at an output path."""

    output_field: str  # dotted path in the final output
    from_semantic: str  # dotted semantic path to read from the normalized event


@dataclass
class OutputProfile:
    """A user-selectable representation of a normalized event."""

    name: str
    description: str = ""
    is_preset: bool = False
    fields: list[OutputField] = field(default_factory=list)
    include_all: bool = False  # emit the entire normalized event unchanged

    def to_schema(self) -> dict:
        return {
            "include_all": self.include_all,
            "fields": [
                {"output_field": f.output_field, "from": f.from_semantic}
                for f in self.fields
            ],
        }

    @classmethod
    def from_schema(
        cls, name: str, schema: dict, is_preset: bool = False, description: str = ""
    ) -> "OutputProfile":
        fields = [
            OutputField(output_field=f["output_field"], from_semantic=f["from"])
            for f in schema.get("fields", [])
        ]
        return cls(
            name=name,
            description=description,
            is_preset=is_preset,
            fields=fields,
            include_all=schema.get("include_all", False),
        )