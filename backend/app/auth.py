import os
import json
import jwt
import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()
_jwks_cache: dict | None = None


def _get_key(kid: str):
    global _jwks_cache
    if _jwks_cache is None:
        supabase_url = os.environ.get("SUPABASE_URL", "")
        if not supabase_url:
            raise HTTPException(status_code=500, detail="Auth not configured")
        resp = httpx.get(f"{supabase_url}/auth/v1/.well-known/jwks.json", timeout=5.0)
        _jwks_cache = {k["kid"]: k for k in resp.json().get("keys", [])}
    jwk = _jwks_cache.get(kid)
    if not jwk:
        raise HTTPException(status_code=401, detail="Unknown signing key")
    return jwt.algorithms.ECAlgorithm.from_jwk(json.dumps(jwk))


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> str:
    token = credentials.credentials
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")

        if alg == "HS256":
            secret = os.environ.get("SUPABASE_JWT_SECRET", "")
            if not secret:
                raise HTTPException(status_code=500, detail="Auth not configured")
            payload = jwt.decode(token, secret, algorithms=["HS256"], options={"verify_aud": False})
        else:
            key = _get_key(header.get("kid", ""))
            payload = jwt.decode(token, key, algorithms=[alg], options={"verify_aud": False})

        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
