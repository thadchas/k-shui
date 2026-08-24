"""Login, logout, current user and the OIDC authorization-code flow."""

from __future__ import annotations

import secrets
import time
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse

from k_shui.api.schemas.security import LoginRequest, LoginResponse, UserInfo
from k_shui.config import Settings
from k_shui.core.audit import audit, client_ip
from k_shui.core.auth import (
    ANONYMOUS_ADMIN,
    Principal,
    Unauthorized,
    authenticate,
    create_token,
    get_principal,
)
from k_shui.core.errors import BadRequest, IntegrationNotConfigured, UpstreamError
from k_shui.core.logging import get_logger
from k_shui.core.registry import get_settings

log = get_logger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

_LOGIN_ATTEMPTS: dict[str, list[float]] = {}
RATE_LIMIT_WINDOW = 60.0
RATE_LIMIT_MAX = 10
_OIDC_STATES: dict[str, float] = {}


def _rate_limit(ip: str | None) -> None:
    key = ip or "unknown"
    now = time.time()
    attempts = [t for t in _LOGIN_ATTEMPTS.get(key, []) if now - t < RATE_LIMIT_WINDOW]
    if len(attempts) >= RATE_LIMIT_MAX:
        raise Unauthorized("too many login attempts; try again shortly")
    attempts.append(now)
    _LOGIN_ATTEMPTS[key] = attempts


@router.get("/me", response_model=UserInfo)
async def me(principal: Principal = Depends(get_principal)) -> UserInfo:
    return UserInfo(**principal.to_dict())


@router.post("/login", response_model=LoginResponse)
async def login(
    request: Request, body: LoginRequest, settings: Settings = Depends(get_settings)
) -> LoginResponse:
    if settings.auth.type == "none":
        token, exp = create_token(settings, ANONYMOUS_ADMIN)
        return LoginResponse(token=token, expiresAt=exp, user=UserInfo(**ANONYMOUS_ADMIN.to_dict()))
    if settings.auth.type != "basic":
        raise BadRequest("password login is disabled; use the OIDC flow")
    _rate_limit(client_ip(request))
    principal = await authenticate(settings, body.username, body.password)
    if principal is None:
        log.info("auth.login_failed", username=body.username, ip=client_ip(request))
        raise Unauthorized("invalid username or password")
    request.state.principal = principal
    await audit(request, "auth.login", resource=principal.username, details={"role": principal.role})
    token, exp = create_token(settings, principal)
    return LoginResponse(token=token, expiresAt=exp, user=UserInfo(**principal.to_dict()))


@router.post("/logout")
async def logout(request: Request) -> JSONResponse:
    response = JSONResponse({"ok": True})
    response.delete_cookie("kshui_token")
    await audit(request, "auth.logout")
    return response


def _oidc(settings: Settings) -> Any:
    if settings.auth.type != "oidc" or settings.auth.oidc is None:
        raise IntegrationNotConfigured("OIDC is not configured")
    return settings.auth.oidc


@router.get("/oidc/login")
async def oidc_login(
    request: Request, redirectUri: str | None = None, settings: Settings = Depends(get_settings)
):
    cfg = _oidc(settings)
    metadata = await _discover(cfg.issuer)
    state = secrets.token_urlsafe(24)
    _OIDC_STATES[state] = time.time()
    callback = redirectUri or str(request.url_for("oidc_callback"))
    params = {
        "response_type": "code",
        "client_id": cfg.clientId,
        "redirect_uri": callback,
        "scope": " ".join(cfg.scopes),
        "state": state,
    }
    from urllib.parse import urlencode

    return RedirectResponse(f"{metadata['authorization_endpoint']}?{urlencode(params)}")


@router.get("/oidc/callback", name="oidc_callback", response_model=LoginResponse)
async def oidc_callback(
    request: Request, code: str, state: str | None = None, settings: Settings = Depends(get_settings)
) -> LoginResponse:
    cfg = _oidc(settings)
    if state and state not in _OIDC_STATES:
        raise Unauthorized("invalid OIDC state")
    _OIDC_STATES.pop(state or "", None)
    metadata = await _discover(cfg.issuer)
    import httpx

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            metadata["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": str(request.url_for("oidc_callback")),
                "client_id": cfg.clientId,
                "client_secret": cfg.clientSecret,
            },
        )
    if resp.status_code >= 400:
        raise UpstreamError(f"OIDC token exchange failed: {resp.text[:300]}")
    payload = resp.json()
    from jose import jwt

    claims = jwt.get_unverified_claims(payload.get("id_token") or payload.get("access_token", ""))
    roles = claims.get(cfg.rolesClaim) or []
    if isinstance(roles, str):
        roles = [roles]
    role = (
        "admin"
        if set(roles) & set(cfg.adminRoles)
        else ("editor" if set(roles) & set(cfg.editorRoles) else cfg.defaultRole)
    )
    if role == "none":
        raise Unauthorized("no k-shui role assigned to this account")
    principal = Principal(
        username=str(claims.get("preferred_username") or claims.get("sub")), role=role, claims=claims
    )
    request.state.principal = principal
    await audit(request, "auth.oidc_login", resource=principal.username, details={"role": role})
    token, exp = create_token(settings, principal)
    return LoginResponse(token=token, expiresAt=exp, user=UserInfo(**principal.to_dict()))


async def _discover(issuer: str) -> dict[str, Any]:
    import httpx

    url = issuer.rstrip("/") + "/.well-known/openid-configuration"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url)
    if resp.status_code >= 400:
        raise UpstreamError(f"OIDC discovery failed at {url}: {resp.status_code}")
    return resp.json()
