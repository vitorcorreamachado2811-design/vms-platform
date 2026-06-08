from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from uuid import UUID
import uuid

from app.database import get_db
from app.models.models import Empresa

router = APIRouter()

class EmpresaCreate(BaseModel):
    nome: str
    email: str

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