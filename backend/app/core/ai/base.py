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

    def __post_init__(self) -> None:
        """Contract guarantee: only schema-clean proposals reach storage.

        Providers validate model output (raising keeps the heuristic
        fallback honest); this is the last line of defense so a malformed
        row can never be persisted, whatever builds it.
        """
        if not isinstance(self.renamed_from, dict):
            self.renamed_from = {}
        else:
            self.renamed_from = {
                k: v
                for k, v in self.renamed_from.items()
                if isinstance(k, str) and isinstance(v, str)
            }
        if not isinstance(self.explanation, str):
            self.explanation = ""


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