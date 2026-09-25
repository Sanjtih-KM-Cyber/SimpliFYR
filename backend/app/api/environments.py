from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db

from app.models import Environment

router = APIRouter(prefix="/environments", tags=["environments"])


class EnvironmentCreate(BaseModel):
    name: str
    description: str = ""


class EnvironmentResponse(BaseModel):
    id: int
    name: str
    description: str = ""


def seed_default_environment(db: Session) -> None:
    """Ensure a default environment exists (multi-tenancy baseline)."""
    if db.execute(select(Environment)).first() is None:
        db.add(Environment(name="Default", description="Default environment"))
        db.commit()


@router.get("", response_model=list[EnvironmentResponse])
def list_environments(db: Session = Depends(get_db)):
    return [
        EnvironmentResponse(id=e.id, name=e.name, description=e.description or "")
        for e in db.execute(select(Environment).order_by(Environment.id)).scalars().all()
    ]


@router.post("", response_model=EnvironmentResponse, status_code=201)
def create_environment(payload: EnvironmentCreate, db: Session = Depends(get_db)):
    existing = db.execute(
        select(Environment).where(Environment.name == payload.name)
    ).scalars().first()
    if existing:
        raise HTTPException(status_code=409, detail="Environment already exists")
    env = Environment(name=payload.name, description=payload.description)
    db.add(env)
    db.commit()
    db.refresh(env)
    return EnvironmentResponse(id=env.id, name=env.name, description=env.description or "")