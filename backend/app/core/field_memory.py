"""Online field memory: approved mappings teach future AI proposals.

The heuristic keyword rules and the frozen LLM weights never change at
runtime. This module adds the online layer on top: every human-approved
(PUBLISHED) mapping is global memory. When a new source presents a field
name a human has mapped before — including custom semantics like
``firewall.rule`` or ``threat.level`` — the proposal reuses that assignment
instead of abstaining.

No new tables, no retraining, no restarts:

- write path: ``publish_mapping_knowledge`` / drift versioning already write
  ``MappingField`` rows with status PUBLISHED. Memory reads those rows, so
  learning takes effect on the next proposal (30s cache TTL at most).
- read path: ``overlay_memory`` fills abstained/low-confidence suggestions
  with the most recently published assignment for the same normalized field
  name (exact match after lowercasing + stripping non-alphanumerics).
- conflicts (same input mapped two ways): most recent PUBLISHED wins; the
  prior assignment stays in history/audit, nothing is overwritten.
"""

from __future__ import annotations

import re
import time

LEARNED_CONFIDENCE = 0.97
_CACHE_TTL_SECONDS = 30.0

_cache_loaded_at: float = 0.0
# normalized input field -> (semantic_field, mapping_name, source)
_cache: dict[str, tuple[str, str | None, str | None]] = {}


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def invalidate_memory() -> None:
    """Drop the cached memory (called after publishing new knowledge)."""
    global _cache_loaded_at, _cache
    _cache_loaded_at = 0.0
    _cache = {}


def _load_memory(db) -> dict[str, tuple[str, str | None, str | None]]:
    from sqlalchemy import select

    from app.models import Mapping as MappingModel
    from app.models import MappingField

    rows = (
        db.execute(
            select(MappingField.input_field, MappingField.semantic_field, MappingModel.name, MappingModel.source)
            .join(MappingModel, MappingField.mapping_id == MappingModel.id)
            .where(MappingModel.status.in_(("published", "approved")))
            .order_by(MappingModel.id.desc())
            .limit(20000)
        ).all()
    )
    memory: dict[str, tuple[str, str | None, str | None]] = {}
    for input_field, semantic_field, mapping_name, source in rows:
        if not input_field or not semantic_field:
            continue
        key = _norm(str(input_field))
        if not key or key in memory:
            continue  # most recent PUBLISHED wins (id DESC)
        memory[key] = (str(semantic_field), mapping_name, source)
    return memory


def _memory(db) -> dict[str, tuple[str, str | None, str | None]]:
    global _cache_loaded_at, _cache
    now = time.monotonic()
    if now - _cache_loaded_at < _CACHE_TTL_SECONDS and _cache:
        return _cache
    try:
        _cache = _load_memory(db)
        _cache_loaded_at = now
    except Exception:
        pass  # fail-open: proposals work without memory
    return _cache


def lookup(db, input_field: str) -> tuple[str, str | None, str | None] | None:
    """Most recent approved (semantic, mapping, source) for an input name."""
    if db is None or not input_field:
        return None
    return _memory(db).get(_norm(input_field))


def overlay_memory(db, suggestions: list, known_inputs: list[str] | None = None) -> list:
    """Fill abstained suggestions from global approved memory (in place).

    Only touches suggestions with an empty semantic (or zero confidence):
    keyword/LLM assignments are never overridden, learned memory only fills
    gaps — e.g. a custom semantic a human taught last week.
    Returns the same list for chaining.
    """
    if db is None:
        return suggestions
    try:
        memory = _memory(db)
    except Exception:
        return suggestions
    if not memory:
        return suggestions
    for suggestion in suggestions or []:
        try:
            current = getattr(suggestion, "semantic_field", "") or ""
            confidence = float(getattr(suggestion, "confidence", 0.0) or 0.0)
        except Exception:
            continue
        if current and confidence > 0:
            continue
        input_field = getattr(suggestion, "input_field", "") or ""
        hit = memory.get(_norm(input_field))
        if hit is None:
            continue
        semantic, mapping_name, _source = hit
        try:
            suggestion.semantic_field = semantic
            suggestion.confidence = LEARNED_CONFIDENCE
            label = f"learned from approved mapping '{mapping_name}'" if mapping_name else "learned from an approved mapping"
            suggestion.reason = label
        except Exception:
            continue
    return suggestions
