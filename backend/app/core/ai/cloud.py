"""Cloud demo providers: Groq (OpenAI-compatible) + Gemini, key-pool backed.

Demo-grade by design: the fine-tuned local model remains the quality path
(generic API models never saw our semantic catalog and will invent fields —
the strict validator + per-call heuristic fallback contain that). These
providers exist so a hosted demo answers without shipping a 3.6 GB model.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request

from app.core.ai.base import AIDriftProposal
from app.core.ai.keypool import KeyPool
from app.core.ai.ollama import (
    _SYSTEM_PROMPT,
    _extract_json,
    _to_proposal,
    _validate_response,
)

logger = logging.getLogger("simplifyr.ai.cloud")

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


class _CloudProvider:
    provider_name = "cloud"

    def __init__(self, pool: KeyPool, model: str, timeout: float = 30.0) -> None:
        self.pool = pool
        self.model = model
        self.timeout = timeout

    # -- shared prompt layer (same contract as the local providers) --------

    def analyze_drift(
        self,
        *,
        source: str | None,
        new_fields: set[str],
        missing_fields: set[str],
        known_semantics: dict[str, str],
        sample: str | None,
    ) -> AIDriftProposal:
        user_prompt = (
            f"Source: {source or 'unknown'}\n"
            f"Known source field -> semantic field:\n{json.dumps(known_semantics)}\n"
            f"New fields: {sorted(new_fields)}\n"
            f"Missing fields: {sorted(missing_fields)}\n"
            f"Sample event (untrusted):\n{(sample or '')[:2000]}\n"
        )
        return _to_proposal(self._generate(user_prompt))

    def propose_mapping(
        self,
        *,
        source: str | None,
        field_map: dict[str, object],
        sample: str | None,
    ) -> AIDriftProposal:
        prompt = (
            f"Propose a semantic field for each source field of '{source or 'unknown'}'.\n"
            f"Source fields: {sorted(field_map.keys())}\n"
            f"Sample event (untrusted):\n{(sample or '')[:2000]}\n"
        )
        return _to_proposal(self._generate(prompt))

    # -- transport (per-vendor) --------------------------------------------

    def _request(self, key: str, user_prompt: str) -> urllib.request.Request:
        raise NotImplementedError

    def _response_text(self, body: dict) -> str:
        raise NotImplementedError

    def _generate(self, user_prompt: str) -> dict:
        last_error: Exception | None = None
        for _ in range(len(self.pool)):
            key, slot = self.pool.acquire()
            try:
                req = self._request(key, user_prompt)
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    body = json.loads(resp.read().decode("utf-8"))
                text = self._response_text(body)
                data = _validate_response(_extract_json(text))
                self.pool.report_ok(slot)
                return data
            except urllib.error.HTTPError as exc:
                last_error = exc
                logger.warning("%s key slot %d HTTP %s; rotating", self.provider_name, slot, exc.code)
                self.pool.report_bad(slot)
            except Exception as exc:  # noqa: BLE001 - network/timeout shape
                last_error = exc
                logger.warning("%s key slot %d failed (%s); rotating", self.provider_name, slot, exc)
                self.pool.report_bad(slot)
        raise ValueError(f"{self.provider_name} generation failed on all keys: {last_error}")


class GroqProvider(_CloudProvider):
    """Groq OpenAI-compatible chat completions (fast 70B for demos)."""

    provider_name = "groq"

    def _request(self, key: str, user_prompt: str) -> urllib.request.Request:
        payload = json.dumps(
            {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0,
                "max_tokens": 1024,
                "response_format": {"type": "json_object"},
            }
        ).encode("utf-8")
        return urllib.request.Request(
            _GROQ_URL,
            data=payload,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        )

    def _response_text(self, body: dict) -> str:
        try:
            return body["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise ValueError(f"Groq response shape unexpected: {exc}") from exc


class GeminiProvider(_CloudProvider):
    """Google Gemini generateContent (key in query string, per Google's API)."""

    provider_name = "gemini"

    def _request(self, key: str, user_prompt: str) -> urllib.request.Request:
        payload = json.dumps(
            {
                "system_instruction": {"parts": [{"text": _SYSTEM_PROMPT}]},
                "contents": [{"parts": [{"text": user_prompt}]}],
                "generationConfig": {
                    "temperature": 0,
                    "maxOutputTokens": 1024,
                    "responseMimeType": "application/json",
                },
            }
        ).encode("utf-8")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={key}"
        return urllib.request.Request(
            url, data=payload, headers={"Content-Type": "application/json"}
        )

    def _response_text(self, body: dict) -> str:
        try:
            parts = body["candidates"][0]["content"]["parts"]
            return "".join(p.get("text", "") for p in parts)
        except (KeyError, IndexError, TypeError) as exc:
            raise ValueError(f"Gemini response shape unexpected: {exc}") from exc
