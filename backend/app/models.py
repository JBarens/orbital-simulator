from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String
from database import Base


class Satellite(Base):
    __tablename__ = "satellites"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    tle_line1 = Column(String, nullable=False)
    tle_line2 = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    user_id = Column(String, nullable=True, index=True)  # Supabase user UUID
