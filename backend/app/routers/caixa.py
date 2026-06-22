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


class LeituraBalanca(BaseModel):
    empresa_id: UUID
    camera_id: Optional[UUID] = None
    peso_gramas: float
    valor_balanca: float


class RegistrarVenda(BaseModel):
    empresa_id: UUID
    camera_id: Optional[UUID] = None
    peso_gramas: Optional[float] = None
    valor_balanca: float
    cedula_recebida: float
    troco_calculado: float
    troco_detectado: Optional[float] = None


# Cache da ultima leitura da balanca por empresa
_ultima_leitura: dict = {}


@router.post("/leitura")
def receber_leitura(dados: LeituraBalanca):
    """
    Recebe leitura da balanca Toledo via leitor serial.
    Armazena em memoria para ser cruzada com deteccao da camera.
    """
    chave = str(dados.empresa_id)
    _ultima_leitura[chave] = {
        "peso_gramas": dados.peso_gramas,
        "valor_balanca": dados.valor_balanca,
        "camera_id": str(dados.camera_id) if dados.camera_id else None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    return {"ok": True, "peso": dados.peso_gramas, "valor": dados.valor_balanca}


@router.get("/leitura/{empresa_id}")
def obter_leitura(empresa_id: str):
    """Retorna ultima leitura da balanca para esta empresa."""
    leitura = _ultima_leitura.get(empresa_id)
    if not leitura:
        raise HTTPException(status_code=404, detail="Sem leitura disponivel")
    return leitura


@router.post("/venda")
def registrar_venda(dados: RegistrarVenda, db: Session = Depends(get_db)):
    """
    Registra uma venda completa com deteccao de inconsistencia de troco.
    Chamado pelo worker quando detecta cedulas na camera do caixa.
    """
    troco_esperado = dados.cedula_recebida - dados.valor_balanca
    troco_real     = dados.troco_detectado if dados.troco_detectado is not None else troco_esperado

    # Tolerancia de R$0.10 para erros de deteccao
    diferenca = abs(troco_real - troco_esperado)
    status    = "inconsistente" if diferenca > 0.10 else "ok"
    observacao = None

    if status == "inconsistente":
        if troco_real < troco_esperado:
            observacao = f"Troco a menor: esperado R${troco_esperado:.2f}, detectado R${troco_real:.2f}"
        else:
            observacao = f"Troco a maior: esperado R${troco_esperado:.2f}, detectado R${troco_real:.2f}"

    venda_id = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO caixa_vendas
            (id, empresa_id, camera_id, peso_gramas, valor_balanca,
             cedula_recebida, troco_calculado, troco_detectado, status, observacao, criado_em)
        VALUES
            (:id, :empresa_id, :camera_id, :peso, :valor,
             :cedula, :troco_calc, :troco_det, :status, :obs, :criado_em)
    """), {
        "id": venda_id,
        "empresa_id": str(dados.empresa_id),
        "camera_id": str(dados.camera_id) if dados.camera_id else None,
        "peso": dados.peso_gramas,
        "valor": dados.valor_balanca,
        "cedula": dados.cedula_recebida,
        "troco_calc": troco_esperado,
        "troco_det": troco_real,
        "status": status,
        "obs": observacao,
        "criado_em": datetime.now(timezone.utc).isoformat(),
    })
    db.commit()

    if status == "inconsistente":
        print(f"[CAIXA] ALERTA inconsistencia: {observacao}", flush=True)

    return {"ok": True, "id": venda_id, "status": status, "observacao": observacao}


@router.get("/vendas")
def listar_vendas(empresa_id: str, limit: int = 100, db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT id, empresa_id, camera_id, peso_gramas, valor_balanca,
               cedula_recebida, troco_calculado, troco_detectado,
               status, observacao, criado_em
        FROM caixa_vendas
        WHERE empresa_id = :empresa_id
        ORDER BY criado_em DESC
        LIMIT :limit
    """), {"empresa_id": empresa_id, "limit": limit})

    rows = result.fetchall()
    return [
        {
            "id": str(r.id),
            "peso_gramas": float(r.peso_gramas) if r.peso_gramas else None,
            "valor_balanca": float(r.valor_balanca),
            "cedula_recebida": float(r.cedula_recebida),
            "troco_calculado": float(r.troco_calculado),
            "troco_detectado": float(r.troco_detectado) if r.troco_detectado else None,
            "status": r.status,
            "observacao": r.observacao,
            "criado_em": r.criado_em.isoformat() if r.criado_em else None,
        }
        for r in rows
    ]


@router.get("/resumo")
def resumo_caixa(empresa_id: str, db: Session = Depends(get_db)):
    """Resumo do dia atual."""
    result = db.execute(text("""
        SELECT
            COUNT(*) as total_vendas,
            COALESCE(SUM(valor_balanca), 0) as total_valor,
            COUNT(*) FILTER (WHERE status = 'inconsistente') as total_inconsistentes,
            COALESCE(SUM(CASE WHEN status = 'inconsistente'
                THEN ABS(troco_detectado - troco_calculado) ELSE 0 END), 0) as total_diferenca
        FROM caixa_vendas
        WHERE empresa_id = :empresa_id
          AND criado_em >= DATE_TRUNC('day', NOW())
    """), {"empresa_id": empresa_id})

    row = result.fetchone()
    return {
        "total_vendas": row.total_vendas or 0,
        "total_valor": float(row.total_valor or 0),
        "total_inconsistentes": row.total_inconsistentes or 0,
        "total_diferenca": float(row.total_diferenca or 0),
    }
