from __future__ import annotations

from copy import deepcopy

from output_profiles.model import OutputField, OutputProfile


def get_path(data: dict, path: str):
    value = data
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def set_path(target: dict, path: str, value) -> None:
    parts = path.split(".")
    node = target
    for part in parts[:-1]:
        node = node.setdefault(part, {})
    node[parts[-1]] = value


def apply_output_profile(normalized: dict, profile: OutputProfile) -> dict:
    """Render a normalized semantic event into a user-defined output representation."""
    if profile.include_all:
        return deepcopy(normalized)
    output: dict = {}
    for field in profile.fields:
        value = get_path(normalized, field.from_semantic)
        if value is None:
            continue
        set_path(output, field.output_field, value)
    return output