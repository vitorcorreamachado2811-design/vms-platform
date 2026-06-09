from fastapi import APIRouter, HTTPException
from typing import Optional
from datetime import datetime, timezone
import os
from supabase import create_client

router = APIRouter()

def get_supabase():
    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"]
    )


@router.get("/perfil/{camera_id}")
def get_perfil_habitos(camera_id: str):
    supabase = get_supabase()
    result = supabase.table("habitos_perfil").select("*").eq(
        "camera_id", camera_id
    ).execute()
    return result.data


@router.get("/alertas")
def get_alertas(
    empresa_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50
):
    supabase = get_supabase()
    query = supabase.table("habitos_alertas").select(
        "*, cameras(nome, localizacao)"
    ).order("created_at", desc=True).limit(limit)

    if empresa_id:
        query = query.eq("empresa_id", empresa_id)
    if status:
        query = query.eq("status", status)

    result = query.execute()
    return result.data


@router.patch("/alertas/{alerta_id}/resolver")
def resolver_alerta(alerta_id: str):
    supabase = get_supabase()
    result = supabase.table("habitos_alertas").update({
        "status": "resolvido",
        "resolvido_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", alerta_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Alerta não encontrado")
    return {"ok": True}


@router.patch("/alertas/{alerta_id}/falso-positivo")
def marcar_falso_positivo(alerta_id: str):
    supabase = get_supabase()
    result = supabase.table("habitos_alertas").update({
        "status": "falso_positivo",
        "resolvido_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", alerta_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Alerta não encontrado")
    return {"ok": True}


@router.get("/registros/{camera_id}")
def get_registros(camera_id: str, tipo: Optional[str] = None, dias: int = 7):
    from datetime import timedelta
    supabase = get_supabase()
    desde = (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat()

    query = supabase.table("habitos_registros").select("*").eq(
        "camera_id", camera_id
    ).gte("horario_evento", desde).order("horario_evento", desc=False)

    if tipo:
        query = query.eq("tipo", tipo)

    result = query.execute()
    return result.data


@router.get("/resumo/{empresa_id}")
def get_resumo_empresa(empresa_id: str):
    supabase = get_supabase()

    alertas_pendentes = supabase.table("habitos_alertas").select(
        "id", count="exact"
    ).eq("empresa_id", empresa_id).eq("status", "pendente").execute()

    perfis_ativos = supabase.table("habitos_perfil").select(
        "id", count="exact"
    ).eq("empresa_id", empresa_id).eq("aprendizado_completo", True).execute()

    ultimo_alerta = supabase.table("habitos_alertas").select(
        "tipo, created_at, desvio_minutos, status"
    ).eq("empresa_id", empresa_id).order(
        "created_at", desc=True
    ).limit(1).execute()

    return {
        "alertas_pendentes": alertas_pendentes.count or 0,
        "habitos_aprendidos": perfis_ativos.count or 0,
        "ultimo_alerta": ultimo_alerta.data[0] if ultimo_alerta.data else None
    }