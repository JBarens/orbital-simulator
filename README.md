# Orbital Simulator

A real-time 3D orbital mechanics visualizer. Track satellites around a photorealistic Earth, scrub forward and backward through time, and detect close-approach conjunctions — all behind per-user authentication.

Live: **https://orbital-simulator.up.railway.app/**

---

## What it does

- **3D globe** rendered with Three.js / React Three Fiber, with an 8K day texture, dynamic night-side terminator shading driven by real Sun position, and an orbiting Moon
- **Add satellites by NORAD ID** — the browser fetches TLE data from `tle.ivanstanojevic.me` (CORS-open) and saves the satellite to the database via the authenticated backend
- **Live propagation** via Skyfield's SGP4 implementation, updating positions every second
- **Ground track trails** showing the last 90 seconds of each satellite's path, painted onto the globe surface
- **Time scrubber** — slide up to 24 hours into the future or past; all satellite positions, trails, Sun direction, and Moon position update in lock-step (T+hh:mm:ss display)
- **Orbital elements panel** — click any satellite label to show inclination, RAAN, eccentricity, argument of perigee, semi-major axis, period, perigee/apogee altitude
- **Conjunction Detection Messages (CDM)** — polls the next 90 minutes and flags any pair of tracked satellites that will come within 50 km of each other
- **Per-user auth** via Supabase (email magic link) — each user's satellite list is isolated

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript, Vite, Three.js, React Three Fiber, @react-three/drei |
| Backend | Python, FastAPI, SQLAlchemy, Skyfield (SGP4), PyJWT + cryptography (ES256 JWKS) |
| Database | PostgreSQL (Railway managed) |
| Auth | Supabase (ES256 JWTs, JWKS verification) |
| Deployment | Railway (frontend + backend + database as separate services) |
| Local dev | Docker Compose (backend + Postgres), Vite dev server |

---

## Architecture

```
Browser
  │
  ├─ Supabase Auth (magic link) → JWT (ES256)
  │
  ├─ tle.ivanstanojevic.me  ← direct browser fetch for TLE data (CORS-open)
  │
  └─ FastAPI backend (Railway)
        ├─ Validates JWT via Supabase JWKS endpoint
        ├─ PostgreSQL  ← satellite records per user
        └─ Skyfield SGP4  ← propagates TLE to lat/lon/elevation
```

The TLE fetch happens in the browser rather than the backend because Railway's outbound network cannot reach satellite data providers. The browser fetches the two TLE lines, then POSTs them to the backend which stores and propagates them.

---

## Local development

**Prerequisites:** Docker, Node 18+

```bash
# 1. Clone and install frontend deps
cd frontend && npm install

# 2. Set env vars
# frontend/.env.local
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_API_URL=http://localhost:8000

# .env (project root, read by docker-compose)
SUPABASE_JWT_SECRET=<your JWT secret>
SUPABASE_URL=https://<your-project>.supabase.co

# 3. Start backend + database
docker-compose up --build

# 4. Start frontend
cd frontend && npm run dev
```

Open http://localhost:5173.

---

## Deployment (Railway)

The project has three Railway services:

| Service | Root | Build |
|---|---|---|
| `frontend` | `frontend/` | nixpacks (Vite → static) |
| `backend` | `backend/` | Dockerfile |
| `database` | — | Railway Postgres plugin |

**Required environment variables on the backend service:**

| Variable | Value |
|---|---|
| `DATABASE_URL` | Postgres connection string (set automatically by Railway plugin) |
| `SUPABASE_URL` | `https://<project>.supabase.co` (no trailing space) |
| `SUPABASE_JWT_SECRET` | From Supabase → Settings → API → JWT Secret |
| `FRONTEND_URL` | Railway frontend URL (added to CORS allowlist) |

**Required environment variables on the frontend service (set at build time):**

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `VITE_API_URL` | `https://<backend>.up.railway.app` (must include `https://`) |

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/satellites/` | Save a satellite (name + TLE lines) |
| `GET` | `/satellites/` | List all satellites for the current user |
| `DELETE` | `/satellites/{id}` | Delete a satellite |
| `GET` | `/satellites/positions` | Propagated lat/lon/elevation for all satellites at `?minutes_from_now=N` |
| `GET` | `/satellites/{id}/position` | Single satellite position |
| `GET` | `/satellites/{id}/elements` | Keplerian orbital elements |
| `GET` | `/satellites/{id}/groundtrack` | Array of positions over the next orbit |
| `GET` | `/cdm` | Conjunction detections within 90 min / 50 km threshold |
| `GET` | `/sun_moon` | Sun and Moon unit vectors at `?minutes_from_now=N` |

All endpoints except `/sun_moon` require a Supabase JWT in the `Authorization: Bearer` header.

---

## Auth implementation note

Supabase issues **ES256** (elliptic-curve) JWTs, not HS256. The backend verifies them by:

1. Fetching the JWKS from `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` (cached in-process)
2. Matching the token's `kid` header to the correct public key
3. Verifying with `PyJWT` + `cryptography` (EC algorithm support)

The `SUPABASE_JWT_SECRET` is kept for HS256 fallback (local Supabase dev), but production tokens use ES256.
