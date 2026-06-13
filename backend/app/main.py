from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session
from database import Base, engine, get_db
from models import Satellite
from propagator import propagate_satellite
from auth import get_current_user
from pydantic import BaseModel
import httpx
import math


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Add user_id column to existing table if not present (idempotent migration)
    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE satellites ADD COLUMN IF NOT EXISTS user_id VARCHAR"
        ))
        conn.commit()
    yield


app = FastAPI(lifespan=lifespan)

import os

_origins = ["http://localhost:5173"]
if os.environ.get("FRONTEND_URL"):
    _origins.append(os.environ["FRONTEND_URL"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)


class SatelliteCreate(BaseModel):
    name: str
    tle_line1: str
    tle_line2: str


def _ecef(pos: dict) -> tuple:
    R = 6371.0
    lat = math.radians(pos["latitude"])
    lon = math.radians(pos["longitude"])
    r = R + pos["elevation_km"]
    return r * math.cos(lat) * math.cos(lon), r * math.cos(lat) * math.sin(lon), r * math.sin(lat)


def _dist(a: tuple, b: tuple) -> float:
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


# ── Satellite CRUD ────────────────────────────────────────────────────────────

@app.post("/satellites/")
def create_satellite(
    data: SatelliteCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    sat = Satellite(name=data.name, tle_line1=data.tle_line1, tle_line2=data.tle_line2, user_id=user_id)
    db.add(sat)
    db.commit()
    db.refresh(sat)
    return sat


@app.get("/satellites/")
def list_satellites(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    return db.query(Satellite).filter(Satellite.user_id == user_id).all()


@app.delete("/satellites/{id}")
def delete_satellite(
    id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    sat = db.query(Satellite).filter(Satellite.id == id, Satellite.user_id == user_id).first()
    if not sat:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(sat)
    db.commit()
    return {"ok": True}


@app.post("/satellites/fetch/{norad_id}")
def fetch_satellite(
    norad_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    url = f"https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=tle"
    try:
        response = httpx.get(url, verify=False, follow_redirects=True, timeout=10.0)
    except httpx.TimeoutException:
        return {"error": "CelesTrak request timed out"}
    except httpx.RequestError as e:
        return {"error": f"Network error: {e}"}
    lines = response.text.strip().splitlines()
    if len(lines) < 3:
        return {"error": "Could not fetch TLE data for that NORAD ID"}
    sat = Satellite(name=lines[0].strip(), tle_line1=lines[1], tle_line2=lines[2], user_id=user_id)
    db.add(sat)
    db.commit()
    db.refresh(sat)
    return sat


# ── Position / propagation ────────────────────────────────────────────────────

@app.get("/satellites/positions")
def get_all_positions(
    minutes_from_now: float = 0.0,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    satellites = db.query(Satellite).filter(Satellite.user_id == user_id).all()
    return [
        {"id": sat.id, "name": sat.name,
         **propagate_satellite(sat.tle_line1, sat.tle_line2, sat.name, minutes_from_now)}
        for sat in satellites
    ]


@app.get("/satellites/{id}/position")
def get_position(
    id: int,
    minutes_from_now: float = 0.0,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    sat = db.query(Satellite).filter(Satellite.id == id, Satellite.user_id == user_id).first()
    if not sat:
        raise HTTPException(status_code=404, detail="Satellite not found")
    return propagate_satellite(sat.tle_line1, sat.tle_line2, sat.name, minutes_from_now)


@app.get("/satellites/{id}/groundtrack")
def get_groundtrack(
    id: int,
    steps: int = 18,
    step_minutes: float = 5.0,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    sat = db.query(Satellite).filter(Satellite.id == id, Satellite.user_id == user_id).first()
    if not sat:
        raise HTTPException(status_code=404, detail="Satellite not found")
    return [
        {"id": sat.id, "name": sat.name, "minutes_from_now": i * step_minutes,
         **propagate_satellite(sat.tle_line1, sat.tle_line2, sat.name, i * step_minutes)}
        for i in range(steps)
    ]


@app.get("/satellites/{id}/elements")
def get_elements(
    id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    sat = db.query(Satellite).filter(Satellite.id == id, Satellite.user_id == user_id).first()
    if not sat:
        raise HTTPException(status_code=404, detail="Not found")

    line2 = sat.tle_line2
    inclination  = float(line2[8:16].strip())
    raan         = float(line2[17:25].strip())
    eccentricity = float("0." + line2[26:33].strip())
    arg_perigee  = float(line2[34:42].strip())
    mean_anomaly = float(line2[43:51].strip())
    mean_motion  = float(line2[52:63].strip())

    mu = 398600.4418
    n  = mean_motion * 2 * math.pi / 86400
    a  = (mu / n ** 2) ** (1 / 3)
    e  = eccentricity
    R  = 6371.0

    return {
        "name": sat.name,
        "inclination":         round(inclination,  4),
        "raan":                round(raan,         4),
        "eccentricity":        round(e,            7),
        "arg_perigee":         round(arg_perigee,  4),
        "mean_anomaly":        round(mean_anomaly, 4),
        "semi_major_axis_km":  round(a,            1),
        "period_minutes":      round((2 * math.pi / n) / 60, 2),
        "perigee_altitude_km": round(a * (1 - e) - R, 1),
        "apogee_altitude_km":  round(a * (1 + e) - R, 1),
    }


# ── CDM ───────────────────────────────────────────────────────────────────────

@app.get("/cdm")
def get_conjunctions(
    threshold_km: float = 50.0,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    satellites = db.query(Satellite).filter(Satellite.user_id == user_id).all()
    if len(satellites) < 2:
        return []

    current = [
        {"sat": sat, "xyz": _ecef(propagate_satellite(sat.tle_line1, sat.tle_line2, sat.name, 0))}
        for sat in satellites
    ]

    conjunctions = []
    for i in range(len(current)):
        for j in range(i + 1, len(current)):
            a, b = current[i], current[j]
            current_dist = _dist(a["xyz"], b["xyz"])

            min_dist = current_dist
            tca_min = 0
            for t in range(1, 91):
                pa = _ecef(propagate_satellite(a["sat"].tle_line1, a["sat"].tle_line2, a["sat"].name, t))
                pb = _ecef(propagate_satellite(b["sat"].tle_line1, b["sat"].tle_line2, b["sat"].name, t))
                d = _dist(pa, pb)
                if d < min_dist:
                    min_dist = d
                    tca_min = t

            if min_dist < threshold_km:
                conjunctions.append({
                    "sat1": a["sat"].name,
                    "sat2": b["sat"].name,
                    "distance_km": round(current_dist, 1),
                    "min_distance_km": round(min_dist, 1),
                    "tca_minutes": tca_min,
                })

    return conjunctions


# ── Sun / Moon (public — no auth needed) ─────────────────────────────────────

@app.get("/sun_moon")
def get_sun_moon(minutes_from_now: float = 0.0):
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now)

    a = (14 - now.month) // 12
    y = now.year + 4800 - a
    m = now.month + 12 * a - 3
    jdn = now.day + (153 * m + 2) // 5 + 365 * y + y // 4 - y // 100 + y // 400 - 32045
    jd = jdn + (now.hour - 12) / 24 + now.minute / 1440 + now.second / 86400
    n = jd - 2451545.0

    L = (280.460 + 0.9856474 * n) % 360
    g = math.radians((357.528 + 0.9856003 * n) % 360)
    lam = math.radians(L + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g))
    eps = math.radians(23.439 - 0.0000004 * n)

    sx = math.cos(lam)
    sy = math.cos(eps) * math.sin(lam)
    sz = math.sin(eps) * math.sin(lam)

    Lm = (218.316 + 13.176396 * n) % 360
    Mm = math.radians((134.963 + 13.064993 * n) % 360)
    Om = math.radians((125.045 - 0.052954 * n) % 360)
    lam_m = math.radians(Lm + 6.289 * math.sin(Mm))
    beta_m = math.radians(5.128 * math.sin(Om))

    mx = math.cos(beta_m) * math.cos(lam_m)
    my = math.cos(eps) * math.cos(beta_m) * math.sin(lam_m) - math.sin(eps) * math.sin(beta_m)
    mz = math.sin(eps) * math.cos(beta_m) * math.sin(lam_m) + math.cos(eps) * math.sin(beta_m)

    def to_scene(x, y, z):
        return {"x": round(x, 6), "y": round(z, 6), "z": round(-y, 6)}

    return {"sun": to_scene(sx, sy, sz), "moon": to_scene(mx, my, mz)}
