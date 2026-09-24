# Cloud demo providers: key-pool rotation + Groq transport (HTTP mocked —
# no network, no keys leave this file).
import json
import urllib.error

import pytest

from app.core.ai.cloud import GeminiProvider, GroqProvider
from app.core.ai.keypool import KeyPool

GOOD_CONTENT = json.dumps(
    {
        "suggestions": [
            {"input_field": "srcip", "semantic_field": "source.ip", "confidence": 0.9}
        ],
        "renamed_from": {},
        "explanation": "ok",
    }
)


class _FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps(self._payload).encode("utf-8")


def _groq_body(content=GOOD_CONTENT):
    return {"choices": [{"message": {"content": content}}]}


def test_pool_round_robins_and_skips_cooling():
    pool = KeyPool(["a", "b", "c"], cooldown_s=60)
    assert pool.acquire() == ("a", 0)
    assert pool.acquire() == ("b", 1)
    pool.report_bad(2)  # c cooling -> skipped twice, then a/b cycle
    assert pool.acquire() == ("a", 0)
    assert pool.acquire() == ("b", 1)
    assert pool.acquire() == ("a", 0)
    pool.report_ok(2)  # c recovered -> back in rotation
    assert pool.acquire() == ("b", 1)
    assert pool.acquire() == ("c", 2)


def test_pool_all_cooling_reuses_least_stale():
    pool = KeyPool(["a", "b"], cooldown_s=60)
    pool.report_bad(0)
    pool.report_bad(1)
    key, _ = pool.acquire()
    assert key in ("a", "b")


def test_pool_needs_a_key():
    with pytest.raises(ValueError):
        KeyPool([])


def test_groq_success_uses_first_key(monkeypatch):
    seen = []

    def fake(req, timeout=None):
        seen.append(req.headers.get("Authorization"))
        return _FakeResp(_groq_body())

    monkeypatch.setattr("urllib.request.urlopen", fake)
    p = GroqProvider(KeyPool(["k1", "k2"]), "llama-3.3-70b-versatile")
    proposal = p.propose_mapping(source="s", field_map={"srcip": "x"}, sample="raw")
    assert seen == ["Bearer k1"]
    assert proposal.new_field_suggestions[0].semantic_field == "source.ip"


def test_groq_429_rotates_to_next_key(monkeypatch):
    seen = []

    def fake(req, timeout=None):
        auth = req.headers.get("Authorization")
        seen.append(auth)
        if auth == "Bearer k1":
            raise urllib.error.HTTPError(req.full_url, 429, "rate limited", {}, None)
        return _FakeResp(_groq_body())

    monkeypatch.setattr("urllib.request.urlopen", fake)
    p = GroqProvider(KeyPool(["k1", "k2"]), "llama-3.3-70b-versatile")
    proposal = p.propose_mapping(source="s", field_map={"srcip": "x"}, sample="raw")
    assert seen == ["Bearer k1", "Bearer k2"]
    assert proposal.new_field_suggestions[0].semantic_field == "source.ip"


def test_groq_all_keys_down_raises(monkeypatch):
    def fake(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 500, "down", {}, None)

    monkeypatch.setattr("urllib.request.urlopen", fake)
    p = GroqProvider(KeyPool(["k1", "k2"]), "llama-3.3-70b-versatile")
    with pytest.raises(ValueError, match="all keys"):
        p.propose_mapping(source="s", field_map={"srcip": "x"}, sample="raw")


def test_gemini_parses_candidates(monkeypatch):
    def fake(req, timeout=None):
        assert "generateContent?key=g1" in req.full_url
        return _FakeResp({"candidates": [{"content": {"parts": [{"text": GOOD_CONTENT}]}}]})

    monkeypatch.setattr("urllib.request.urlopen", fake)
    p = GeminiProvider(KeyPool(["g1"]), "gemini-2.0-flash")
    proposal = p.propose_mapping(source="s", field_map={"srcip": "x"}, sample="raw")
    assert proposal.new_field_suggestions[0].semantic_field == "source.ip"
