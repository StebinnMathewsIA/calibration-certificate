"""Bearer-token verification.

AUTH_MODE=supabase — verifies Supabase Auth JWTs. The mobile app signs in
through Supabase Auth (which federates Microsoft/Azure, Google, and Apple);
this backend only ever sees the Supabase-issued JWT. Verification prefers
the project's JWKS endpoint (asymmetric "JWT signing keys"); projects still
on the legacy shared secret can set SUPABASE_JWT_SECRET (HS256) instead.

AUTH_MODE=jwks — generic OIDC broker (Auth0 / Cognito / ...), kept for
portability.

AUTH_MODE=disabled — LOCAL DEV bypass returning a stub identity.
"""
from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, Request

from .config import Settings, get_settings


@dataclass(frozen=True)
class Identity:
    subject: str
    name: str
    auth_method: str  # microsoft | google | apple


@lru_cache
def _jwk_client(jwks_url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(jwks_url, cache_keys=True)


def _bearer_token(request: Request) -> str:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return header[7:]


# ---------------------------------------------------------------------------
# Supabase Auth
# ---------------------------------------------------------------------------

# Supabase provider slugs -> the form's authMethod enum
_SUPABASE_PROVIDERS = {"azure": "microsoft", "google": "google", "apple": "apple"}


def _verify_supabase(token: str, settings: Settings) -> Identity:
    if not settings.supabase_url:
        raise HTTPException(status_code=500, detail="SUPABASE_URL is not configured")
    issuer = f"{settings.supabase_url.rstrip('/')}/auth/v1"
    try:
        if settings.supabase_jwt_secret:
            # Legacy HS256 project secret
            claims = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
                issuer=issuer,
            )
        else:
            # Asymmetric JWT signing keys (recommended) via the project JWKS
            signing_key = _jwk_client(f"{issuer}/.well-known/jwks.json").get_signing_key_from_jwt(
                token
            )
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "RS256"],
                audience="authenticated",
                issuer=issuer,
            )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc

    app_meta = claims.get("app_metadata") or {}
    user_meta = claims.get("user_metadata") or {}
    provider = _SUPABASE_PROVIDERS.get(str(app_meta.get("provider", "")).lower())
    if provider is None:
        raise HTTPException(status_code=403, detail="Sign-in provider not permitted")
    subject = claims.get("sub", "")
    name = user_meta.get("full_name") or user_meta.get("name") or claims.get("email") or subject
    return Identity(subject=subject, name=str(name), auth_method=provider)


# ---------------------------------------------------------------------------
# Generic OIDC broker
# ---------------------------------------------------------------------------


def _auth_method_from_subject(subject: str) -> str:
    # Auth0-style subjects look like "windowslive|...", "google-oauth2|...",
    # "apple|...". Adjust the mapping to the broker in use.
    prefix = subject.split("|")[0].lower()
    if "google" in prefix:
        return "google"
    if "apple" in prefix:
        return "apple"
    return "microsoft"


def _verify_generic_jwks(token: str, settings: Settings) -> Identity:
    try:
        signing_key = _jwk_client(settings.auth_jwks_url).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            audience=settings.auth_audience,
            issuer=settings.auth_issuer,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc
    subject = claims.get("sub", "")
    return Identity(
        subject=subject,
        name=claims.get("name", subject),
        auth_method=_auth_method_from_subject(subject),
    )


def get_identity(request: Request, settings: Settings = Depends(get_settings)) -> Identity:
    if settings.auth_mode == "disabled":
        return Identity(subject="dev|local", name="Dev Technician", auth_method="microsoft")
    token = _bearer_token(request)
    if settings.auth_mode == "supabase":
        return _verify_supabase(token, settings)
    if settings.auth_mode == "jwks":
        return _verify_generic_jwks(token, settings)
    raise HTTPException(status_code=500, detail=f"Unknown AUTH_MODE: {settings.auth_mode}")
