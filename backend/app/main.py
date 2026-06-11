from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from database import Base, engine, get_db
from models import Satellite
from propagtor import propagate_satellite
import httpx

app = FastAPI()

Base.metadata.create_all(bind=engine)


@app.post("/satellites/")
def create_satellite(name: str, tle_line1: str, tle_line2: str, db: Session = Depends(get_db)):
    sat = Satellite(name=name, tle_line1=tle_line1, tle_line2=tle_line2)
    db.add(sat)
    db.commit()
    db.refresh(sat)
    return sat


@app.get("/satellites/{id}/position")
def get_position(id: int, db: Session = Depends(get_db)):
    sat = db.query(Satellite).filter(Satellite.id == id).first()
    return propagate_satellite(sat.tle_line1, sat.tle_line2, sat.name)


@app.post("/satellites/fetch/{norad_id}")
def fetch_satellite(norad_id: int, db: Session = Depends(get_db)):
    url = f"https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=tle"
    response = httpx.get(url, verify=False, follow_redirects=True)
    lines = response.text.strip().splitlines()
    if len(lines) < 3:
        return {"error": "Could not fetch TLE data for that NORAD ID"}
    sat = Satellite(name=lines[0].strip(), tle_line1=lines[1], tle_line2=lines[2])
    db.add(sat)
    db.commit()
    db.refresh(sat)
    return sat
