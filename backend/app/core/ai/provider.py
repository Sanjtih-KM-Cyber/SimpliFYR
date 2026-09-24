from __future__ import annotations

import logging

from app.core.ai.cloud import GeminiProvider, GroqProvider
from app.core.ai.heuristic import HeuristicAIProvider
from app.core.ai.keypool import KeyPool
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

    if settings.ai_provider in ("groq", "gemini"):
        try:
            if settings.ai_provider == "groq":
                pool = KeyPool(settings.groq_api_keys.split(","))
                _provider = GroqProvider(pool, settings.groq_model)
            else:
                pool = KeyPool(settings.gemini_api_keys.split(","))
                _provider = GeminiProvider(pool, settings.gemini_model)
            logger.info("AI provider: %s (%d keys)", settings.ai_provider, len(pool))
            return _provider
        except Exception as exc:  # noqa: BLE001
            logger.warning("%s provider unavailable (%s); using heuristic", settings.ai_provider, exc)

    _provider = HeuristicAIProvider()
    logger.info("AI provider: heuristic")
    return _provider


def reset_provider() -> None:
    """Drop the cached provider (used by tests for isolation)."""
    global _provider
    _provider = None


def _heuristic():
    return HeuristicAIProvider()


def analyze_drift_safe(**kwargs):
    """Analyze drift, falling back to the heuristic provider per call.

    Construction-time fallback (above) only covers startup misconfiguration.
    A running Ollama can still fail per request (timeout, malformed JSON);
    callers use this so one bad model response never breaks the workflow.
    """
    provider = get_ai_provider()
    try:
        return provider.analyze_drift(**kwargs)
    except Exception as exc:  # noqa: BLE001
        logger.warning("AI analyze_drift failed (%s); heuristic fallback", exc)
        return _heuristic().analyze_drift(**kwargs)


def propose_mapping_safe(**kwargs):
    """Propose a mapping, falling back to the heuristic provider per call."""
    provider = get_ai_provider()
    try:
        return provider.propose_mapping(**kwargs)
    except Exception as exc:  # noqa: BLE001
        logger.warning("AI propose_mapping failed (%s); heuristic fallback", exc)
        return _heuristic().propose_mapping(**kwargs)