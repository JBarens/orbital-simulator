from datetime import datetime, timedelta, timezone
from skyfield.api import EarthSatellite, load


def propagate_satellite(tle_line1, tle_line2, name, minutes_from_now: float = 0.0) -> dict:
    ts = load.timescale()
    satellite = EarthSatellite(tle_line1, tle_line2, name, ts)
    t = ts.from_datetime(datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now))
    geocentric = satellite.at(t)
    subpoint = geocentric.subpoint()
    return {
        "latitude": subpoint.latitude.degrees,
        "longitude": subpoint.longitude.degrees,
        "elevation_km": subpoint.elevation.km,
    }
