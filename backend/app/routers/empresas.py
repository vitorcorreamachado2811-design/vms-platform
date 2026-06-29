from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
import uuid
import os
import httpx
import asyncio
from app.database import get_db
from app.models.models import Empresa

RAILWAY_API_TOKEN = os.environ.get("RAILWAY_API_TOKEN", "")
RAILWAY_PROJECT_ID = os.environ.get("RAILWAY_PROJECT_ID", "")
RAILWAY_ENVIRONMENT_ID = os.environ.get("RAILWAY_ENVIRONMENT_ID", "")
GITHUB_REPO = "vitorcorreamachado2811-design/vms-platform"

VARIAVEIS_WORKER = [
    ("EMPRESA_ID", "{empresa_id}"),
    ("API_BASE", os.environ.get("API_BASE", "https://vms-platform-production.up.railway.app")),
    ("SUPABASE_URL", os.environ.get("SUPABASE_URL", "")),
    ("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_SERVICE_KEY", "")),
    ("MEDIAMTX_RTSP_URL", os.environ.get("MEDIAMTX_RTSP_URL", "rtsp://wonderful-laughter.railway.internal:8554")),
]

async def criar_worker_railway(empresa_id: str, empresa_nome: str):
    if not RAILWAY_API_TOKEN or not RAILWAY_PROJECT_ID:
        print("[RAILWAY] Token ou Project ID nao configurado", flush=True)
        return None
    nome_worker = "worker-" + empresa_nome.lower().replace(" ", "-")
    query_create = (
        'mutation { serviceCreate(input: { '
        'projectId: "' + RAILWAY_PROJECT_ID + '" '
        'name: "' + nome_worker + '" '
        'source: { repo: "' + GITHUB_REPO + '" } '
        '}) { id name } }'
    )
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://backboard.railway.com/graphql/v2",
                json={"query": query_create},
                headers={"Authorization": "Bearer " + RAILWAY_API_TOKEN, "Content-Type": "application/json"},
                timeout=30
            )
            data = res.json()
            if "errors" in data:
                print("[RAILWAY] Erro criar worker: " + str(data["errors"]), flush=True)
                return None
            service_id = data["data"]["serviceCreate"]["id"]
            print("[RAILWAY] Worker criado: " + service_id, flush=True)

            # Adiciona todas as variaveis necessarias
            for nome_var, valor_var in VARIAVEIS_WORKER:
                val = valor_var.replace("{empresa_id}", empresa_id)
                query_var = (
                    'mutation { variableUpsert(input: { '
                    'projectId: "' + RAILWAY_PROJECT_ID + '" '
                    'serviceId: "' + service_id + '" '
                    'environmentId: "' + RAILWAY_ENVIRONMENT_ID + '" '
                    'name: "' + nome_var + '" '
                    'value: "' + val + '" '
                    '}) }'
                )
                await client.post(
                    "https://backboard.railway.com/graphql/v2",
                    json={"query": query_var},
                    headers={"Authorization": "Bearer " + RAILWAY_API_TOKEN, "Content-Type": "application/json"}
                )
                print("[RAILWAY] Variavel " + nome_var + " configurada", flush=True)

            # Configura o root directory para o worker
            query_instance = (
                'mutation { serviceInstanceUpdate(serviceId: "' + service_id + '" input: { '
                'rootDirectory: "/" '
                'startCommand: "python worker.py" '
                '}) }'
            )
            await client.post(
                "https://backboard.railway.com/graphql/v2",
                json={"query": query_instance},
                headers={"Authorization": "Bearer " + RAILWAY_API_TOKEN, "Content-Type": "application/json"}
            )
            print("[RAILWAY] Worker configurado e pronto!", flush=True)
            return service_id
    except Exception as e:
        print("[RAILWAY] Erro: " + str(e), flush=True)
        return None

router = APIRouter()

class EmpresaCreate(BaseModel):
    nome: str
    email: str

class EmpresaUpdate(BaseModel):
    nome: Optional[str] = None
    email: Optional[str] = None

class EmpresaResponse(BaseModel):
    id: UUID
    nome: str
    email: str
    ativo: bool
    class Config:
        from_attributes = True

@router.get("/", response_model=list[EmpresaResponse])
def listar_empresas(db: Session = Depends(get_db)):
    return db.query(Empresa).all()

@router.post("/", response_model=EmpresaResponse)
async def criar_empresa(empresa: EmpresaCreate, db: Session = Depends(get_db)):
    nova = Empresa(
        id=uuid.uuid4(),
        nome=empresa.nome,
        email=empresa.email,
    )
    db.add(nova)
    db.commit()
    db.refresh(nova)
    asyncio.create_task(criar_worker_railway(str(nova.id), nova.nome))
    print("[EMPRESA] Criada " + nova.nome + " - iniciando worker Railway", flush=True)
    return nova

@router.get("/{empresa_id}", response_model=EmpresaResponse)
def buscar_empresa(empresa_id: UUID, db: Session = Depends(get_db)):
    empresa = db.query(Empresa).filter(Empresa.id == empresa_id).first()
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada")
    return empresa

@router.patch("/{empresa_id}", response_model=EmpresaResponse)
def editar_empresa(empresa_id: UUID, dados: EmpresaUpdate, db: Session = Depends(get_db)):
    empresa = db.query(Empresa).filter(Empresa.id == empresa_id).first()
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada")
    if dados.nome is not None:
        empresa.nome = dados.nome
    if dados.email is not None:
        empresa.email = dados.email
    db.commit()
    db.refresh(empresa)
    return empresa

@router.delete("/{empresa_id}")
def deletar_empresa(empresa_id: UUID, db: Session = Depends(get_db)):
    empresa = db.query(Empresa).filter(Empresa.id == empresa_id).first()
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada")
    db.delete(empresa)
    db.commit()
    return {"ok": True}