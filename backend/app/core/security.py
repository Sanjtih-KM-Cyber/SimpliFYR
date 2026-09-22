from __future__ import annotations

import hashlib
import secrets

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings

_bearer = HTTPBearer(auto_error=False)

READ_ROLES = ("analyst", "operator", "admin")
WRITE_ROLES = ("operator", "admin")

# Mutable auth state initialized from settings; tests override it to exercise RBAC
# regardless of the process-wide settings singleton's load order.
# Tokens are held ONLY as SHA-256 hashes — plaintext never persists in memory
# past initialization/rotation (compare by hashing the presented credential).
_auth_enabled: bool | None = None
_api_key_hashes: dict[str, str] | None = None
_auth_backend: str | None = None


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _state() -> tuple[bool, dict[str, str], str]:
    global _auth_enabled, _api_key_hashes, _auth_backend
    if _auth_enabled is None:
        _auth_enabled = settings.auth_enabled
        _api_key_hashes = {role: _hash(tok) for role, tok in dict(settings.api_keys).items()}
        _auth_backend = settings.auth_backend
    return _auth_enabled, _api_key_hashes, _auth_backend


def set_auth(enabled: bool, api_keys: dict[str, str] | None = None) -> None:
    """Override auth state (used by tests). Tokens are hashed on the way in."""
    global _auth_enabled, _api_key_hashes, _auth_backend
    _auth_enabled = enabled
    _api_key_hashes = {role: _hash(tok) for role, tok in dict(api_keys or {}).items()}
    _auth_backend = settings.auth_backend


def auth_status() -> bool:
    return _state()[0]


def rotate_token(role: str) -> str:
    """Generate a fresh token for `role`, store only its hash, return plaintext once."""
    if role not in READ_ROLES:
        raise ValueError(f"Unknown role {role!r}")
    enabled, hashes, _backend = _state()
    token = secrets.token_urlsafe(32)
    hashes[role] = _hash(token)
    return token


def get_role(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """Resolve the caller's role from a bearer token.

    When auth is disabled (dev), an implicit 'admin' role is returned so the API
    is fully open. When enabled, an unknown/missing token is rejected (401).
    With AUTH_BACKEND=oidc, bearer JWTs are verified against the issuer instead.
    """
    enabled, hashes, backend = _state()
    if not enabled:
        return "admin"
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Missing credentials")
    token = credentials.credentials
    if backend == "oidc":
        return _role_from_oidc(token)
    presented = _hash(token)
    for role, expected_hash in hashes.items():
        if secrets.compare_digest(expected_hash, presented):
            return role
    raise HTTPException(status_code=401, detail="Invalid credentials")


def _role_from_oidc(token: str) -> str:
    """Verify a bearer JWT via the configured OIDC issuer and map its role claim."""
    payload = _verified_oidc_claims(token)
    claim = settings.oidc_role_claim
    roles = payload.get(claim, [])
    if isinstance(roles, str):
        roles = [roles]
    for candidate in roles:
        if candidate in READ_ROLES:
            return candidate
    # Fall back to a subject-authenticated analyst when the claim is absent.
    if payload.get("sub"):
        return "analyst"
    raise HTTPException(status_code=403, detail="No authorized role in token")


def _verified_oidc_claims(token: str) -> dict:
    """Verify signature + issuer/audience via JWKS; never accept unsigned tokens."""
    try:
        import jwt
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="OIDC backend selected but PyJWT is not installed",
        )
    try:
        jwks_url = settings.oidc_jwks_url or f"{settings.oidc_issuer}/.well-known/jwks.json"
        jwks_client = jwt.PyJWKClient(jwks_url)
        key = jwks_client.get_signing_key_from_jwt(token).key
        return jwt.decode(
            token,
            key=key,
            algorithms=["RS256"],
            audience=settings.oidc_audience or None,
            issuer=settings.oidc_issuer or None,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=401, detail=f"Token verification failed: {exc}")


def require_roles(*roles: str):
    """Dependency factory: require the caller to hold one of `roles`."""

    def dependency(role: str = Depends(get_role)) -> str:
        if role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return role

    return dependency


require_auth = require_roles(*READ_ROLES)
require_write = require_roles(*WRITE_ROLES)
require_admin = require_roles("admin")
