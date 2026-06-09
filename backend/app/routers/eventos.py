from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
import uuid
from datetime import datetime, UTC
from app.database import get_db
from app.models.models import Evento

router = APIRouter()

class EventoCreate(BaseModel):
    camera_id: UUID
    tipo: str
    confianca: float

class EventoUpdate(BaseModel):
    video_url: Optional[str] = None

class EventoResponse(BaseModel):
    id: UUID
    camera_id: UUID
    tipo: str
    confianca: float
    criado_em: datetime
    video_url: Optional[str] = None

    class Config:
        from_attributes = True

@router.post("/", response_model=EventoResponse)
def criar_evento(evento: EventoCreate, db: Session = Depends(get_db)):
    novo = Evento(
        id=uuid.uuid4(),
        camera_id=evento.camera_id,
        tipo=evento.tipo,
        confianca=evento.confianca,
    )
    db.add(novo)
    db.commit()
    db.refresh(novo)
    return novo

@router.patch("/{evento_id}", response_model=EventoResponse)
def atualizar_evento(evento_id: UUID, body: EventoUpdate, db: Session = Depends(get_db)):
    evento = db.query(Evento).filter(Evento.id == evento_id).first()
    if evento and body.video_url:
        evento.video_url = body.video_url
        db.commit()
        db.refresh(evento)
    return evento

@router.get("/", response_model=list[EventoResponse])
def listar_eventos(db: Session = Depends(get_db)):
    return db.query(Evento).order_by(Evento.criado_em.desc()).limit(50).all()

@router.get("/camera/{camera_id}", response_model=list[EventoResponse])
def eventos_por_camera(camera_id: UUID, db: Session = Depends(get_db)):
    return db.query(Evento).filter(
        Evento.camera_id == camera_id
    ).order_by(Evento.criado_em.desc()).limit(20).all()