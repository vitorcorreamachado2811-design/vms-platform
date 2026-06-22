from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
import uuid
from datetime import datetime, timezone
from app.database import get_db

router = APIRouter()


class FreezerStatusCreate(BaseModel):
    camera_id: UUID
    empresa_id: UUID
    nivel_percentual: int
    status: Optional[str] = "ok"


class FreezerConfigCreate(BaseModel):
    camera_id: UUID
    empresa_id: UUID
    nome: Optional[str] = "Freezer"
    threshold_alerta: Optional[int] = 30
    notificacao: Optional[str] = "dashboard"
    ativo: Optional[bool] = True


class FreezerConfigUpdate(BaseModel):
    nome: Optional[str] = None
    threshold_alerta: Optional[int] = None
    notificacao: Optional[str] = None
    ativo: Optional[bool] = None


@router.post("/status")
def registrar_status(dados: FreezerStatusCreate, db: Session = Depends(get_db)):
    # Busca config para determinar status correto
    config = db.execute(text("""
        SELECT threshold_alerta, nome FROM freezer_config
        WHERE camera_id = :camera_id
    """), {"camera_id": str(dados.camera_id)}).fetchone()

    threshold = config.threshold_alerta if config else 30
    status = "critico" if dados.nivel_percentual <= threshold else (
        "baixo" if dados.nivel_percentual <= threshold + 15 else "ok"
    )

    db.execute(text("""
        INSERT INTO freezer_status (id, camera_id, empresa_id, nivel_percentual, status, created_at)
        VALUES (:id, :camera_id, :empresa_id, :nivel, :status, :created_at)
    """), {
        "id": str(uuid.uuid4()),
        "camera_id": str(dados.camera_id),
        "empresa_id": str(dados.empresa_id),
        "nivel": dados.nivel_percentual,
        "status": status,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.commit()
    return {"ok": True, "status": status, "nivel": dados.nivel_percentual}


@router.get("/status")
def listar_status(empresa_id: str, db: Session = Depends(get_db)):
    """Ultimo status de cada freezer da empresa."""
    result = db.execute(text("""
        SELECT DISTINCT ON (fs.camera_id)
            fs.camera_id, fs.nivel_percentual, fs.status, fs.created_at,
            COALESCE(fc.nome, 'Freezer') as nome,
            COALESCE(fc.threshold_alerta, 30) as threshold_alerta,
            COALESCE(fc.notificacao, 'dashboard') as notificacao
        FROM freezer_status fs
        LEFT JOIN freezer_config fc ON fc.camera_id = fs.camera_id
        WHERE fs.empresa_id = :empresa_id
        ORDER BY fs.camera_id, fs.created_at DESC
    """), {"empresa_id": empresa_id})

    rows = result.fetchall()
    return [
        {
            "camera_id": str(r.camera_id),
            "nivel_percentual": r.nivel_percentual,
            "status": r.status,
            "nome": r.nome,
            "threshold_alerta": r.threshold_alerta,
            "notificacao": r.notificacao,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.get("/historico")
def historico(camera_id: str, limit: int = 48, db: Session = Depends(get_db)):
    """Historico de nivel das ultimas horas."""
    result = db.execute(text("""
        SELECT nivel_percentual, status, created_at
        FROM freezer_status
        WHERE camera_id = :camera_id
        ORDER BY created_at DESC
        LIMIT :limit
    """), {"camera_id": camera_id, "limit": limit})

    rows = result.fetchall()
    return [
        {
            "nivel_percentual": r.nivel_percentual,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/config")
def salvar_config(dados: FreezerConfigCreate, db: Session = Depends(get_db)):
    db.execute(text("""
        INSERT INTO freezer_config (id, camera_id, empresa_id, nome, threshold_alerta, notificacao, ativo, updated_at)
        VALUES (:id, :camera_id, :empresa_id, :nome, :threshold, :notificacao, :ativo, :updated_at)
        ON CONFLICT (camera_id) DO UPDATE SET
            nome = EXCLUDED.nome,
            threshold_alerta = EXCLUDED.threshold_alerta,
            notificacao = EXCLUDED.notificacao,
            ativo = EXCLUDED.ativo,
            updated_at = EXCLUDED.updated_at
    """), {
        "id": str(uuid.uuid4()),
        "camera_id": str(dados.camera_id),
        "empresa_id": str(dados.empresa_id),
        "nome": dados.nome,
        "threshold": dados.threshold_alerta,
        "notificacao": dados.notificacao,
        "ativo": dados.ativo,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    db.commit()
    return {"ok": True}


@router.patch("/config/{camera_id}")
def atualizar_config(camera_id: str, dados: FreezerConfigUpdate, db: Session = Depends(get_db)):
    campos = []
    params = {"camera_id": camera_id}
    if dados.nome is not None:
        campos.append("nome = :nome"); params["nome"] = dados.nome
    if dados.threshold_alerta is not None:
        campos.append("threshold_alerta = :threshold"); params["threshold"] = dados.threshold_alerta
    if dados.notificacao is not None:
        campos.append("notificacao = :notificacao"); params["notificacao"] = dados.notificacao
    if dados.ativo is not None:
        campos.append("ativo = :ativo"); params["ativo"] = dados.ativo
    if not campos:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar")
    campos.append("updated_at = :updated_at")
    params["updated_at"] = datetime.now(timezone.utc).isoformat()
    db.execute(text(f"UPDATE freezer_config SET {', '.join(campos)} WHERE camera_id = :camera_id"), params)
    db.commit()
    return {"ok": True}


@router.get("/config/{camera_id}")
def buscar_config(camera_id: str, db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT * FROM freezer_config WHERE camera_id = :camera_id
    """), {"camera_id": camera_id}).fetchone()
    if not result:
        raise HTTPException(status_code=404, detail="Config nao encontrada")
    return {
        "camera_id": str(result.camera_id),
        "empresa_id": str(result.empresa_id),
        "nome": result.nome,
        "threshold_alerta": result.threshold_alerta,
        "notificacao": result.notificacao,
        "ativo": result.ativo,
    }
