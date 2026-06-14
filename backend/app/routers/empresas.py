from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
import uuid
from app.database import get_db
from app.models.models import Empresa

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
def criar_empresa(empresa: EmpresaCreate, db: Session = Depends(get_db)):
    nova = Empresa(
        id=uuid.uuid4(),
        nome=empresa.nome,
        email=empresa.email,
    )
    db.add(nova)
    db.commit()
    db.refresh(nova)
    return nova

@router.get("/{empresa_id}", response_model=EmpresaResponse)
def buscar_empresa(empresa_id: UUID, db: Session = Depends(get_db)):
    empresa = db.query(Empresa).filter(Empresa.id == empresa_id).first()
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    return empresa

@router.patch("/{empresa_id}", response_model=EmpresaResponse)
def editar_empresa(empresa_id: UUID, dados: EmpresaUpdate, db: Session = Depends(get_db)):
    empresa = db.query(Empresa).filter(Empresa.id == empresa_id).first()
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
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
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    db.delete(empresa)
    db.commit()
    return {"ok": True}