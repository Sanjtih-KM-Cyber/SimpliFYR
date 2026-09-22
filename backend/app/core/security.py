from __future__ import annotations

import secrets

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings

_bearer = HTTPBearer(auto_error=False)

READ_ROLES = ("analyst", "operator", "admin")
WRITE_ROLES = ("operator", "admin")

# Mutable auth state initialized from settings; tests override it to exercise RBAC
# regardless of the process-wide settings singleton's load order.
_auth_enabled: bool | None = None
_api_keys: dict[str, str] | None = None


def _state() -> tuple[bool, dict[str, str]]:
    global _auth_enabled, _api_keys
    if _auth_enabled is None:
        _auth_enabled = settings.auth_enabled
        _api_keys = dict(settings.api_keys)
    return _auth_enabled, _api_keys


def set_auth(enabled: bool, api_keys: dict[str, str] | None = None) -> None:
    """Override auth state (used by tests)."""
    global _auth_enabled, _api_keys
    _auth_enabled = enabled
    _api_keys = api_keys


def auth_status() -> bool:
    return _state()[0]


def get_role(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """Resolve the caller's role from a bearer token.

    When auth is disabled (dev), an implicit 'admin' role is returned so the API
    is fully open. When enabled, an unknown/missing token is rejected (401).
    """
    enabled, keys = _state()
    if not enabled:
        return "admin"
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Missing credentials")
    token = credentials.credentials
    for role, expected in keys.items():
        if secrets.compare_digest(expected, token):
            return role
    raise HTTPException(status_code=401, detail="Invalid credentials")


def require_roles(*roles: str):
    """Dependency factory: require the caller to hold one of `roles`."""

    def dependency(role: str = Depends(get_role)) -> str:
        if role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return role

    return dependency


require_auth = require_roles(*READ_ROLES)
require_write = require_roles(*WRITE_ROLES)