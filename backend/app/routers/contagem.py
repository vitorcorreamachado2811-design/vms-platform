from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from uuid import UUID
import uuid
from datetime import datetime, UTC

from app.database import get_db
from app.models.models import LinhaContagem, Evento

router = APIRouter()

class LinhaCreate(BaseModel):
    camera_id: UUID
    x1: float
    y1: float
    x2: float
    y2: float

class LinhaResponse(BaseModel):
    id: UUID
    camera_id: UUID
    x1: float
    y1: float
    x2: float
    y2: float

    class Config:
        from_attributes = True

@router.get("/{camera_id}", response_model=LinhaResponse)
def buscar_linha(camera_id: UUID, db: Session = Depends(get_db)):
    linha = db.query(LinhaContagem).filter(
        LinhaContagem.camera_id == camera_id
    ).first()
    if not linha:
        raise HTTPException(status_code=404, detail="Linha não configurada")
    return linha

@router.post("/", response_model=LinhaResponse)
def salvar_linha(dados: LinhaCreate, db: Session = Depends(get_db)):
    # Se já existe linha para esta câmera, atualiza
    linha = db.query(LinhaContagem).filter(
        LinhaContagem.camera_id == dados.camera_id
    ).first()

    if linha:
        linha.x1 = dados.x1
        linha.y1 = dados.y1
        linha.x2 = dados.x2
        linha.y2 = dados.y2
        linha.atualizado_em = datetime.now(UTC)
    else:
        linha = LinhaContagem(
            id=uuid.uuid4(),
            camera_id=dados.camera_id,
            x1=dados.x1,
            y1=dados.y1,
            x2=dados.x2,
            y2=dados.y2,
        )
        db.add(linha)

    db.commit()
    db.refresh(linha)
    return linha

@router.get("/{camera_id}/contagem")
def contagem_camera(camera_id: UUID, db: Session = Depends(get_db)):
    """Retorna total de entradas e saídas da câmera."""
    entradas = db.query(Evento).filter(
        Evento.camera_id == camera_id,
        Evento.tipo == "entrada"
    ).count()

    saidas = db.query(Evento).filter(
        Evento.camera_id == camera_id,
        Evento.tipo == "saida"
    ).count()

    return {
        "camera_id": str(camera_id),
        "entradas": entradas,
        "saidas": saidas,
        "saldo": entradas - saidas  # pessoas dentro agora
    }