"""Authentication & authorisation: none | basic | oidc, JWT sessions, roles, read-only mode."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import Depends, Request
from sqlalchemy import select

from k_shui.config import Settings
from k_shui.core.errors import Forbidden, KShuiError, ReadOnly
from k_shui.core.logging import get_logger
from k_shui.core.registry import get_settings
from k_shui.db import session as db_session
from k_shui.db.models import User

log = get_logger(__name__)

ROLE_RANK = {"viewer": 0, "editor": 1, "admin": 2}
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
NON_MUTATING_ATTR = "__kshui_non_mutating__"
JWT_ALG = "HS256"


class Unauthorized(KShuiError):
    status, type, title = 401, "unauthorized", "Unauthorized"


@dataclass(slots=True)
class Principal:
    username: str
    role: str = "viewer"
    clusters: list[str] | None = None
    anonymous: bool = False
    claims: dict[str, Any] = field(default_factory=dict)

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    def can(self, minimum: str) -> bool:
        return ROLE_RANK.get(self.role, -1) >= ROLE_RANK.get(minimum, 99)

    def sees_cluster(self, cluster_id: str) -> bool:
        return self.clusters is None or cluster_id in self.clusters

    def to_dict(self) -> dict[str, Any]:
        return {
            "username": self.username,
            "role": self.role,
            "clusters": self.clusters,
            "anonymous": self.anonymous,
        }


ANONYMOUS_ADMIN = Principal(username="anonymous", role="admin", anonymous=True)


# --------------------------------------------------------------------------- passwords
def hash_password(plain: str) -> str:
    from argon2 import PasswordHasher

    return PasswordHasher().hash(plain)


def verify_password(stored: str, plain: str) -> bool:
    """Verify against an argon2 hash, or compare plaintext (dev convenience)."""
    if not stored:
        return False
    if stored.startswith("$argon2"):
        from argon2 import PasswordHasher
        from argon2.exceptions import VerificationError, VerifyMismatchError

        try:
            return PasswordHasher().verify(stored, plain)
        except (VerifyMismatchError, VerificationError):
            return False
        except Exception:  # malformed hash
            return False
    import hmac

    return hmac.compare_digest(stored, plain)


# --------------------------------------------------------------------------- tokens
def create_token(settings: Settings, principal: Principal) -> tuple[str, int]:
    from jose import jwt

    now = int(time.time())
    exp = now + settings.auth.sessionHours * 3600
    payload = {
        "sub": principal.username,
        "role": principal.role,
        "clusters": principal.clusters,
        "iat": now,
        "exp": exp,
        "iss": "k-shui",
    }
    token = jwt.encode(payload, settings.auth.jwtSecret or "insecure", algorithm=JWT_ALG)
    return token, exp


def decode_token(settings: Settings, token: str) -> Principal:
    from jose import jwt
    from jose.exceptions import JWTError

    try:
        claims = jwt.decode(
            token, settings.auth.jwtSecret or "insecure", algorithms=[JWT_ALG], issuer="k-shui"
        )
    except JWTError as exc:
        raise Unauthorized(f"invalid token: {exc}") from exc
    return Principal(
        username=str(claims.get("sub", "unknown")),
        role=str(claims.get("role", "viewer")),
        clusters=claims.get("clusters"),
        claims=claims,
    )


# --------------------------------------------------------------------------- user store
async def sync_config_users(settings: Settings) -> int:
    """Materialise ``auth.users`` from config into the users table."""
    if settings.auth.type != "basic" or not settings.auth.users:
        return 0
    count = 0
    async with db_session.session_scope() as session:
        for u in settings.auth.users:
            stored = u.password if u.password.startswith("$argon2") else hash_password(u.password)
            existing = (
                await session.execute(select(User).where(User.username == u.username))
            ).scalar_one_or_none()
            if existing is None:
                session.add(
                    User(
                        username=u.username,
                        password_hash=stored,
                        role=u.role,
                        source="config",
                        clusters=u.clusters,
                    )
                )
            else:
                existing.password_hash = stored
                existing.role = u.role
                existing.clusters = u.clusters
                existing.source = "config"
            count += 1
    return count


async def authenticate(settings: Settings, username: str, password: str) -> Principal | None:
    """Check config users first (works without a DB), then the users table."""
    for u in settings.auth.users:
        if u.username == username and verify_password(u.password, password):
            return Principal(username=u.username, role=u.role, clusters=u.clusters)
    if db_session.is_ready():
        async with db_session.session_scope() as session:
            row = (await session.execute(select(User).where(User.username == username))).scalar_one_or_none()
            if row is not None and verify_password(row.password_hash, password):
                return Principal(username=row.username, role=row.role, clusters=row.clusters)
    return None


# --------------------------------------------------------------------------- dependencies
def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization")
    if header and header.lower().startswith("bearer "):
        return header.split(" ", 1)[1].strip()
    return request.cookies.get("kshui_token")


async def get_principal(request: Request, settings: Settings = Depends(get_settings)) -> Principal:
    """Resolve the caller. With ``auth.type=none`` every request is an anonymous admin."""
    if settings.auth.type == "none":
        return ANONYMOUS_ADMIN
    token = _bearer(request)
    if not token:
        raise Unauthorized("authentication required")
    principal = decode_token(settings, token)
    request.state.principal = principal
    return principal


async def optional_principal(
    request: Request, settings: Settings = Depends(get_settings)
) -> Principal | None:
    try:
        return await get_principal(request, settings)
    except KShuiError:
        return None


def _read_only_for(request: Request, settings: Settings) -> str | None:
    if settings.server.readOnly:
        return "server is in read-only mode"
    cluster_id = request.path_params.get("cluster_id")
    if cluster_id:
        cfg = settings.cluster(str(cluster_id))
        if cfg is not None and cfg.readOnly:
            return f"cluster '{cluster_id}' is read-only"
    return None


def non_mutating(endpoint: Any) -> Any:
    """Mark a POST/PUT endpoint as read-only (a planner, a validator, a query) so read-only mode
    does not block it. Apply directly on the handler (below the ``@router.<verb>`` decorator)."""
    setattr(endpoint, NON_MUTATING_ATTR, True)
    return endpoint


def is_mutating(request: Request) -> bool:
    if request.method not in MUTATING_METHODS:
        return False
    return not getattr(request.scope.get("endpoint"), NON_MUTATING_ATTR, False)


def enforce_mutation(
    request: Request, settings: Settings, principal: Principal, minimum: str = "editor"
) -> None:
    """Apply the mutating-verb checks by hand, for handlers that decide at runtime whether the
    request mutates anything (e.g. a SQL endpoint that also serves ``SELECT``)."""
    reason = _read_only_for(request, settings)
    if reason:
        raise ReadOnly(reason)
    if not principal.can(minimum):
        raise Forbidden(f"role '{minimum}' required (you are '{principal.role}')")


def require_role(minimum: str = "viewer", mutating: bool | None = None) -> Any:
    """Dependency factory enforcing a minimum role plus read-only mode on mutating verbs.

    ``mutating=False`` skips the read-only check regardless of the verb; by default it is
    derived from the verb and the :func:`non_mutating` marker on the endpoint.
    """

    async def dependency(
        request: Request,
        settings: Settings = Depends(get_settings),
        principal: Principal = Depends(get_principal),
    ) -> Principal:
        if is_mutating(request) if mutating is None else mutating:
            reason = _read_only_for(request, settings)
            if reason:
                raise ReadOnly(reason)
        if not principal.can(minimum):
            raise Forbidden(f"role '{minimum}' required (you are '{principal.role}')")
        cluster_id = request.path_params.get("cluster_id")
        if cluster_id and not principal.sees_cluster(str(cluster_id)):
            raise Forbidden(f"no access to cluster '{cluster_id}'")
        return principal

    return dependency


require_viewer = require_role("viewer")
require_editor = require_role("editor")
require_admin = require_role("admin")

__all__ = [
    "ANONYMOUS_ADMIN",
    "Principal",
    "Unauthorized",
    "authenticate",
    "create_token",
    "decode_token",
    "enforce_mutation",
    "get_principal",
    "hash_password",
    "is_mutating",
    "non_mutating",
    "optional_principal",
    "require_admin",
    "require_editor",
    "require_role",
    "require_viewer",
    "sync_config_users",
    "verify_password",
]
