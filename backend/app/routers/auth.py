from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
import uuid
import hashlib
from app.database import get_db
from app.models.models import Usuario, Empresa

router = APIRouter()

def hash_senha(senha: str) -> str:
    return hashlib.sha256(senha.encode()).hexdigest()

class UsuarioCreate(BaseModel):
    nome: str
    email: str
    senha: str
    empresa_id: UUID
    perfil: Optional[str] = 'familiar'

class UsuarioResponse(BaseModel):
    id: UUID
    nome: str
    email: str
    empresa_id: UUID
    perfil: str = 'familiar'
    class Config:
        from_attributes = True

class LoginRequest(BaseModel):
    email: str
    senha: str

class LoginResponse(BaseModel):
    token: str
    usuario: UsuarioResponse

@router.post("/registrar", response_model=UsuarioResponse)
def registrar(dados: UsuarioCreate, db: Session = Depends(get_db)):
    existente = db.query(Usuario).filter(Usuario.email == dados.email).first()
    if existente:
        raise HTTPException(status_code=400, detail="Email já cadastrado")
    usuario = Usuario(
        id=uuid.uuid4(),
        nome=dados.nome,
        email=dados.email,
        senha_hash=hash_senha(dados.senha),
        empresa_id=dados.empresa_id,
        perfil=dados.perfil or 'familiar',
    )
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    return usuario

@router.get("/usuarios", response_model=list[UsuarioResponse])
def listar_usuarios(empresa_id: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(Usuario)
    if empresa_id:
        query = query.filter(Usuario.empresa_id == empresa_id)
    return query.all()

@router.delete("/usuarios/{usuario_id}")
def deletar_usuario(usuario_id: UUID, db: Session = Depends(get_db)):
    usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    db.delete(usuario)
    db.commit()
    return {"ok": True}

@router.patch("/usuarios/{usuario_id}", response_model=UsuarioResponse)
def atualizar_usuario(usuario_id: UUID, dados: dict, db: Session = Depends(get_db)):
    usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if "perfil" in dados:
        usuario.perfil = dados["perfil"]
    if "nome" in dados:
        usuario.nome = dados["nome"]
    if "ativo" in dados:
        usuario.ativo = dados["ativo"]
    db.commit()
    db.refresh(usuario)
    return usuario

@router.post("/login", response_model=LoginResponse)
def login(dados: LoginRequest, db: Session = Depends(get_db)):
    usuario = db.query(Usuario).filter(Usuario.email == dados.email).first()
    if not usuario or usuario.senha_hash != hash_senha(dados.senha):
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")
    token = hashlib.sha256(f"{usuario.id}{usuario.email}".encode()).hexdigest()
    return LoginResponse(
        token=token,
        usuario=UsuarioResponse(
            id=usuario.id,
            nome=usuario.nome,
            email=usuario.email,
            empresa_id=usuario.empresa_id,
            perfil=usuario.perfil or 'familiar',
        )
    )

@router.get("/me")
def perfil_atual(token: str, db: Session = Depends(get_db)):
    if not token:
        raise HTTPException(status_code=401, detail="Token inválido")
    return {"mensagem": "autenticado", "token": token}