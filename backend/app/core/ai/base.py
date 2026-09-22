from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class FieldSuggestion:
    input_field: str
    semantic_field: str
    confidence: float
    reason: str = ""


@dataclass
class AIDriftProposal:
    """Structured, human-reviewable output from the intelligence layer."""

    new_field_suggestions: list[FieldSuggestion] = field(default_factory=list)
    renamed_from: dict[str, str] = field(default_factory=dict)
    explanation: str = ""
    confidence: float = 0.0


class AIProvider(Protocol):
    """Provider-independent intelligence layer.

    AI proposes; it never silently modifies production behavior. A proposal must be
    human-approved before any new knowledge is published.
    """

    def analyze_drift(
        self,
        *,
        source: str | None,
        new_fields: set[str],
        missing_fields: set[str],
        known_semantics: dict[str, str],
        sample: str | None,
    ) -> AIDriftProposal: ...

    def propose_mapping(
        self,
        *,
        source: str | None,
        field_map: dict[str, object],
        sample: str | None,
    ) -> AIDriftProposal:
        """Suggest a full field -> semantic mapping for a fresh (unmapped) source."""
        ...