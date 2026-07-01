from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
import uuid
from datetime import datetime, UTC, timedelta
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
def listar_eventos(empresa_id: Optional[str] = None, incluir_copos: bool = False, db: Session = Depends(get_db)):
    from app.models.models import Camera
    query = db.query(Evento).join(Evento.camera)
    if empresa_id:
        query = query.filter(Camera.empresa_id == empresa_id)
    if not incluir_copos:
        # Contagem de copos/potes tem relatorio proprio (GET /eventos/relatorio-copos)
        # e nao deve poluir a lista geral de alertas/eventos.
        query = query.filter(Evento.tipo != "copo_pote_contado")
    return query.order_by(Evento.criado_em.desc()).limit(50).all()

@router.get("/relatorio-copos")
def relatorio_copos(empresa_id: str, dias: int = 1, db: Session = Depends(get_db)):
    """Relatorio agregado de copos/potes contados: total geral, por camera e por hora."""
    inicio = datetime.now(UTC) - timedelta(days=dias)
    rows = db.execute(text("""
        SELECT c.id as camera_id, c.nome as camera_nome, e.criado_em
        FROM eventos e
        JOIN cameras c ON c.id = e.camera_id
        WHERE c.empresa_id = :empresa_id
          AND e.tipo = 'copo_pote_contado'
          AND e.criado_em >= :inicio
        ORDER BY e.criado_em
    """), {"empresa_id": empresa_id, "inicio": inicio}).fetchall()

    total_geral = len(rows)
    por_camera: dict = {}
    por_hora: dict = {}
    for r in rows:
        por_camera[r.camera_nome] = por_camera.get(r.camera_nome, 0) + 1
        hora_str = r.criado_em.strftime("%H:00")
        por_hora[hora_str] = por_hora.get(hora_str, 0) + 1

    return {
        "total_geral": total_geral,
        "periodo_dias": dias,
        "por_camera": [
            {"camera": k, "total": v}
            for k, v in sorted(por_camera.items(), key=lambda x: -x[1])
        ],
        "por_hora": [
            {"hora": f"{h:02d}h", "total": por_hora.get(f"{h:02d}:00", 0)}
            for h in range(24)
        ],
    }

@router.get("/camera/{camera_id}", response_model=list[EventoResponse])
def eventos_por_camera(camera_id: UUID, db: Session = Depends(get_db)):
    return db.query(Evento).filter(
        Evento.camera_id == camera_id
    ).order_by(Evento.criado_em.desc()).limit(20).all()