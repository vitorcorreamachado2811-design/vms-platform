from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from uuid import UUID
import uuid
from datetime import datetime, UTC, timedelta

from app.database import get_db
from app.models.models import HeatmapPonto

router = APIRouter()

class PontoCreate(BaseModel):
    x: float
    y: float
    peso: float = 1.0

class BatchCreate(BaseModel):
    camera_id: UUID
    pontos: list[PontoCreate]

class PontoResponse(BaseModel):
    x: float
    y: float
    peso: float

    class Config:
        from_attributes = True

@router.post("/batch")
def salvar_batch(dados: BatchCreate, db: Session = Depends(get_db)):
    """
    Recebe um batch de pontos do worker e salva no banco.
    O worker envia a cada 60s com todas as posições acumuladas.
    """
    for p in dados.pontos:
        ponto = HeatmapPonto(
            id=uuid.uuid4(),
            camera_id=dados.camera_id,
            x=p.x,
            y=p.y,
            peso=p.peso,
        )
        db.add(ponto)
    db.commit()
    return {"salvos": len(dados.pontos)}

@router.get("/{camera_id}")
def buscar_heatmap(camera_id: UUID, horas: int = 24, db: Session = Depends(get_db)):
    """
    Retorna todos os pontos das últimas X horas para renderizar o heatmap.
    Agrupa pontos próximos em células de 5% da tela para reduzir dados.
    """
    desde = datetime.now(UTC) - timedelta(hours=horas)
    pontos = db.query(HeatmapPonto).filter(
        HeatmapPonto.camera_id == camera_id,
        HeatmapPonto.criado_em >= desde
    ).all()

    # Agrega em grid 20x20 (células de 5%)
    grid: dict[tuple, float] = {}
    for p in pontos:
        # Arredonda para célula de 5%
        cx = round(p.x / 0.05) * 0.05
        cy = round(p.y / 0.05) * 0.05
        chave = (cx, cy)
        grid[chave] = grid.get(chave, 0) + p.peso

    resultado = [
        {"x": k[0], "y": k[1], "peso": v}
        for k, v in grid.items()
    ]

    return {
        "camera_id": str(camera_id),
        "total_pontos": len(pontos),
        "horas": horas,
        "grid": resultado
    }

@router.delete("/{camera_id}")
def limpar_heatmap(camera_id: UUID, db: Session = Depends(get_db)):
    """Limpa o heatmap de uma câmera."""
    deleted = db.query(HeatmapPonto).filter(
        HeatmapPonto.camera_id == camera_id
    ).delete()
    db.commit()
    return {"removidos": deleted}