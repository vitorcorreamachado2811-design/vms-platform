from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
import uuid
from app.database import get_db
from app.models.models import RegiaoMonitorada

router = APIRouter()

class RegiaoCreate(BaseModel):
    camera_id: UUID
    tipo: str
    x1: float
    y1: float
    x2: float
    y2: float
    tempo_alerta_min: Optional[int] = 30

class RegiaoUpdate(BaseModel):
    tempo_alerta_min: int

class RegiaoResponse(BaseModel):
    id: UUID
    camera_id: UUID
    tipo: str
    x1: float
    y1: float
    x2: float
    y2: float
    tempo_alerta_min: Optional[int] = 30
    class Config:
        from_attributes = True

@router.get("/{camera_id}", response_model=list[RegiaoResponse])
def listar_regioes(camera_id: UUID, db: Session = Depends(get_db)):
    return db.query(RegiaoMonitorada).filter(RegiaoMonitorada.camera_id == camera_id).all()

@router.post("/", response_model=RegiaoResponse)
def salvar_regiao(dados: RegiaoCreate, db: Session = Depends(get_db)):
    db.query(RegiaoMonitorada).filter(
        RegiaoMonitorada.camera_id == dados.camera_id,
        RegiaoMonitorada.tipo == dados.tipo
    ).delete()
    regiao = RegiaoMonitorada(
        id=uuid.uuid4(),
        camera_id=dados.camera_id,
        tipo=dados.tipo,
        x1=dados.x1, y1=dados.y1, x2=dados.x2, y2=dados.y2,
        tempo_alerta_min=dados.tempo_alerta_min,
    )
    db.add(regiao)
    db.commit()
    db.refresh(regiao)
    return regiao

@router.patch("/{regiao_id}/tempo")
def atualizar_tempo_alerta(regiao_id: UUID, body: RegiaoUpdate, db: Session = Depends(get_db)):
    regiao = db.query(RegiaoMonitorada).filter(RegiaoMonitorada.id == regiao_id).first()
    if not regiao:
        raise HTTPException(status_code=404, detail="Regiao nao encontrada")
    regiao.tempo_alerta_min = body.tempo_alerta_min
    db.commit()
    db.refresh(regiao)
    return regiao

@router.delete("/{camera_id}/{tipo}")
def deletar_regiao(camera_id: UUID, tipo: str, db: Session = Depends(get_db)):
    db.query(RegiaoMonitorada).filter(
        RegiaoMonitorada.camera_id == camera_id,
        RegiaoMonitorada.tipo == tipo
    ).delete()
    db.commit()
    return {"mensagem": "Regiao removida"}
