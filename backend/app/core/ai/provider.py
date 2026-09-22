from __future__ import annotations

import logging

from app.core.ai.heuristic import HeuristicAIProvider
from app.core.ai.ollama import OllamaAIProvider
from app.core.config import settings

logger = logging.getLogger("simplifyr.ai")

_provider = None


def get_ai_provider():
    """Return the configured intelligence provider, with safe fallback."""
    global _provider
    if _provider is not None:
        return _provider

    if settings.ai_provider == "ollama":
        try:
            _provider = OllamaAIProvider(settings.ollama_url, settings.ollama_model)
            logger.info("AI provider: ollama (%s/%s)", settings.ollama_url, settings.ollama_model)
            return _provider
        except Exception as exc:  # noqa: BLE001
            logger.warning("Ollama provider unavailable (%s); using heuristic", exc)

    _provider = HeuristicAIProvider()
    logger.info("AI provider: heuristic")
    return _provider