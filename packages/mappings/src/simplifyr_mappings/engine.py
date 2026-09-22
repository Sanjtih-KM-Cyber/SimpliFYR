from __future__ import annotations

from collections.abc import Mapping as MappingType

from simplifyr_mappings.model import FieldMapping, Mapping, Transformation


def get_path(data: dict, path: str):
    """Read a value from a dict using a dotted path."""
    value = data
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def set_path(target: dict, path: str, value) -> None:
    """Write a value into a (possibly nested) dict using a dotted path."""
    parts = path.split(".")
    node = target
    for part in parts[:-1]:
        node = node.setdefault(part, {})
    node[parts[-1]] = value


def apply_transformation(value, transformation: Transformation):
    """Apply a value transformation, passing values through when not mapped."""
    if transformation is None:
        return value
    if isinstance(transformation, MappingType):
        if value in transformation:
            return transformation[value]
        if "_default" in transformation:
            return transformation["_default"]
        return value
    return value


def apply_mapping(parsed: dict, mapping: Mapping) -> dict:
    """Normalize a parsed event into a semantic event using a mapping."""
    normalized: dict = {}
    for fm in mapping.fields:
        value = get_path(parsed, fm.input_field)
        if value is None:
            continue
        set_path(normalized, fm.semantic_field, apply_transformation(value, fm.transformation))
    return normalized


def apply_mapping_with_provenance(parsed: dict, mapping: Mapping) -> dict:
    """Like apply_mapping but records, per output field, where the value came from.

    Returns {"normalized": {...}, "provenance": {semantic_field: {...}}}.
    """
    normalized: dict = {}
    provenance: dict = {}
    for fm in mapping.fields:
        value = get_path(parsed, fm.input_field)
        if value is None:
            continue
        mapped_value = apply_transformation(value, fm.transformation)
        set_path(normalized, fm.semantic_field, mapped_value)
        provenance[fm.semantic_field] = {
            "input_field": fm.input_field,
            "input_value": value,
            "transformed": mapped_value != value,
            "confidence": fm.confidence,
            "mapping_version": mapping.version,
        }
    return {"normalized": normalized, "provenance": provenance}