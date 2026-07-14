"""Bearer-token verification against the OIDC broker's JWKS endpoint.

The mobile app signs in through one broker (Auth0 / Firebase Auth / Cognito)
that federates Microsoft, Google, and Apple. This backend only ever sees the
broker-issued JWT — it never talks to the individual IdPs.

AUTH_MODE=disabled is a LOCAL DEV bypass returning a stub identity.
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
    auth_method: str  # microsoft | google | apple (from the broker's claims)


@lru_cache
def _jwk_client(jwks_url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(jwks_url, cache_keys=True)


def _auth_method_from_subject(subject: str) -> str:
    # Auth0-style subjects look like "windowslive|...", "google-oauth2|...",
    # "apple|...". Adjust the mapping once the broker is chosen.
    prefix = subject.split("|")[0].lower()
    if "google" in prefix:
        return "google"
    if "apple" in prefix:
        return "apple"
    return "microsoft"


def get_identity(request: Request, settings: Settings = Depends(get_settings)) -> Identity:
    if settings.auth_mode == "disabled":
        return Identity(subject="dev|local", name="Dev Technician", auth_method="microsoft")

    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = header[7:]

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
