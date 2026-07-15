from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
import uuid
import asyncio
from app.database import get_db, SessionLocal
from app.models.models import Empresa
from app.docker_utils import criar_worker_docker


async def criar_worker_e_salvar(empresa_id: str, empresa_nome: str):
    """Cria o worker no Railway e salva o service_id retornado na empresa."""
    service_id = criar_worker_docker(empresa_id, empresa_nome)
    if service_id:
        db = SessionLocal()
        try:
            empresa = db.query(Empresa).filter(Empresa.id == empresa_id).first()
            if empresa:
                empresa.railway_service_id = service_id
                db.commit()
                print(f"[EMPRESA] service_id {service_id} salvo para empresa {empresa_id}", flush=True)
        except Exception as e:
            print(f"[EMPRESA] Erro ao salvar service_id: {e}", flush=True)
            db.rollback()
        finally:
            db.close()

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
    asyncio.create_task(criar_worker_e_salvar(str(nova.id), nova.nome))
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