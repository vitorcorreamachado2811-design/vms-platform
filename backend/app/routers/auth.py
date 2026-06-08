from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
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

class UsuarioResponse(BaseModel):
    id: UUID
    nome: str
    email: str
    empresa_id: UUID

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
    )
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    return usuario

@router.post("/login", response_model=LoginResponse)
def login(dados: LoginRequest, db: Session = Depends(get_db)):
    usuario = db.query(Usuario).filter(Usuario.email == dados.email).first()

    if not usuario or usuario.senha_hash != hash_senha(dados.senha):
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")

    # Token simples por enquanto (vamos melhorar depois com JWT)
    token = hashlib.sha256(f"{usuario.id}{usuario.email}".encode()).hexdigest()

    return LoginResponse(
        token=token,
        usuario=UsuarioResponse(
            id=usuario.id,
            nome=usuario.nome,
            email=usuario.email,
            empresa_id=usuario.empresa_id,
        )
    )

@router.get("/me")
def perfil_atual(token: str, db: Session = Depends(get_db)):
    if not token:
        raise HTTPException(status_code=401, detail="Token inválido")
    return {"mensagem": "autenticado", "token": token}