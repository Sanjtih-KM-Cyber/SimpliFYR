from __future__ import annotations

from fastapi import Header

DEFAULT_ENVIRONMENT = "default"


def get_environment(x_environment: str = Header(default=DEFAULT_ENVIRONMENT)) -> str:
    """Resolve the active environment from the X-Environment header (multi-tenancy)."""
    return (x_environment or DEFAULT_ENVIRONMENT).strip() or DEFAULT_ENVIRONMENT