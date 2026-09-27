"""Name-tag live syslog arrivals (UDP + TCP share this).

A sender IP maps to a connection name ("192.168.1.1=fw01"); otherwise the
optional fixed default applies; otherwise the event stays sourceless
(quarantined, ownerless) exactly as before. Tagged events normalize through
their connection's mapping, show under it, and delete with it.
"""

from __future__ import annotations


def parse_source_map(raw: str | None) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for chunk in (raw or "").split(","):
        if "=" not in chunk:
            continue
        ip, _, name = chunk.partition("=")
        ip, name = ip.strip(), name.strip()
        if ip and name:
            mapping[ip] = name
    return mapping


def resolve_syslog_source(addr: tuple) -> str | None:
    """Connection name for a sender address, or None (sourceless)."""
    from app.core.config import settings

    ip = str(addr[0]).strip() if addr else ""
    name = parse_source_map(settings.syslog_source_map).get(ip, "")
    if name:
        return name
    default = (settings.syslog_default_source or "").strip()
    return default or None
