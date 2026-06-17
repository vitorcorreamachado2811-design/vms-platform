from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID
import uuid
from datetime import datetime, timezone
from app.database import get_db

router = APIRouter()


class VendaCreate(BaseModel):
    camera_id: UUID
    empresa_id: UUID
    quantidade: int
    tipos: Optional[List[str]] = []


class VendaResponse(BaseModel):
    id: UUID
    camera_id: UUID
    empresa_id: UUID
    quantidade: int
    tipos: List[str]
    created_at: datetime

    class Config:
        from_attributes = True


@router.post("/", response_model=VendaResponse)
def registrar_venda(dados: VendaCreate, db: Session = Depends(get_db)):
    result = db.execute(text("""
        INSERT INTO vendas_embalagens (id, camera_id, empresa_id, quantidade, tipos, created_at)
        VALUES (:id, :camera_id, :empresa_id, :quantidade, :tipos::jsonb, :created_at)
        RETURNING id, camera_id, empresa_id, quantidade, tipos, created_at
    """), {
        "id": str(uuid.uuid4()),
        "camera_id": str(dados.camera_id),
        "empresa_id": str(dados.empresa_id),
        "quantidade": dados.quantidade,
        "tipos": str(dados.tipos).replace("'", '"'),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.commit()
    row = result.fetchone()
    return {
        "id": row.id,
        "camera_id": row.camera_id,
        "empresa_id": row.empresa_id,
        "quantidade": row.quantidade,
        "tipos": row.tipos if row.tipos else [],
        "created_at": row.created_at,
    }


@router.get("/")
def listar_vendas(
    empresa_id: str,
    camera_id: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    filtro = "WHERE empresa_id = :empresa_id"
    params = {"empresa_id": empresa_id, "limit": limit}
    if camera_id:
        filtro += " AND camera_id = :camera_id"
        params["camera_id"] = camera_id

    result = db.execute(text(f"""
        SELECT id, camera_id, empresa_id, quantidade, tipos, created_at
        FROM vendas_embalagens
        {filtro}
        ORDER BY created_at DESC
        LIMIT :limit
    """), params)

    rows = result.fetchall()
    return [
        {
            "id": str(r.id),
            "camera_id": str(r.camera_id),
            "empresa_id": str(r.empresa_id),
            "quantidade": r.quantidade,
            "tipos": r.tipos if r.tipos else [],
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.get("/resumo")
def resumo_vendas(empresa_id: str, db: Session = Depends(get_db)):
    """Resumo por hora das ultimas 24h."""
    result = db.execute(text("""
        SELECT
            DATE_TRUNC('hour', created_at) as hora,
            COUNT(*) as total_vendas,
            SUM(quantidade) as total_embalagens,
            ROUND(AVG(quantidade), 1) as media_embalagens
        FROM vendas_embalagens
        WHERE empresa_id = :empresa_id
          AND created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY hora
        ORDER BY hora DESC
    """), {"empresa_id": empresa_id})

    rows = result.fetchall()
    return [
        {
            "hora": r.hora.isoformat() if r.hora else None,
            "total_vendas": r.total_vendas,
            "total_embalagens": r.total_embalagens,
            "media_embalagens": float(r.media_embalagens) if r.media_embalagens else 0,
        }
        for r in rows
    ]


@router.get("/hoje")
def totais_hoje(empresa_id: str, db: Session = Depends(get_db)):
    """Totais do dia atual."""
    result = db.execute(text("""
        SELECT
            COUNT(*) as total_vendas,
            COALESCE(SUM(quantidade), 0) as total_embalagens,
            ROUND(AVG(quantidade), 1) as media_embalagens,
            MAX(created_at) as ultima_venda
        FROM vendas_embalagens
        WHERE empresa_id = :empresa_id
          AND created_at >= DATE_TRUNC('day', NOW())
    """), {"empresa_id": empresa_id})

    row = result.fetchone()
    return {
        "total_vendas": row.total_vendas or 0,
        "total_embalagens": row.total_embalagens or 0,
        "media_embalagens": float(row.media_embalagens) if row.media_embalagens else 0,
        "ultima_venda": row.ultima_venda.isoformat() if row.ultima_venda else None,
    }
