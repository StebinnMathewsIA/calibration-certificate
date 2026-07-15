"""Bearer-token verification against Supabase Auth — the only auth path.

The mobile app signs in through Supabase Auth (which federates
Microsoft/Azure, Google, and Apple); this backend only ever sees the
Supabase-issued JWT. Verification prefers the project's JWKS endpoint
(asymmetric "JWT signing keys"); projects still on the legacy shared secret
can set SUPABASE_JWT_SECRET (HS256) instead.

Only Azure/Google/Apple identities are accepted — any other provider
(e.g. plain email/password sign-ups) is rejected with 403, EXCEPT email
identities whose app_metadata carries an explicit azure/google/apple
provider (used for provisioned service/test accounts).
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
    email: str = ""  # sign-in email — the join key for work-order assignment


# Supabase provider slugs -> the form's authMethod enum
_SUPABASE_PROVIDERS = {"azure": "microsoft", "google": "google", "apple": "apple"}


@lru_cache
def _jwk_client(jwks_url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(jwks_url, cache_keys=True)


def _bearer_token(request: Request) -> str:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return header[7:]


def _decode(token: str, settings: Settings) -> dict:
    issuer = f"{settings.supabase_url.rstrip('/')}/auth/v1"
    try:
        if settings.supabase_jwt_secret:
            # Legacy HS256 project secret
            return jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
                issuer=issuer,
            )
        # Asymmetric JWT signing keys (recommended) via the project JWKS
        signing_key = _jwk_client(f"{issuer}/.well-known/jwks.json").get_signing_key_from_jwt(
            token
        )
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            issuer=issuer,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc


def get_identity(request: Request, settings: Settings = Depends(get_settings)) -> Identity:
    if not settings.supabase_url:
        raise HTTPException(status_code=500, detail="SUPABASE_URL is not configured")
    claims = _decode(_bearer_token(request), settings)

    app_meta = claims.get("app_metadata") or {}
    user_meta = claims.get("user_metadata") or {}
    provider = _SUPABASE_PROVIDERS.get(str(app_meta.get("provider", "")).lower())
    if provider is None:
        raise HTTPException(status_code=403, detail="Sign-in provider not permitted")
    subject = claims.get("sub", "")
    email = str(claims.get("email") or "")
    name = user_meta.get("full_name") or user_meta.get("name") or email or subject
    return Identity(subject=subject, name=str(name), auth_method=provider, email=email)
