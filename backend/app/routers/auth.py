from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
import uuid
import hashlib
import secrets
import string
from datetime import datetime, timezone, timedelta
from app.database import get_db
from app.models.models import Usuario, Empresa

router = APIRouter()

# Armazena convites em memoria (simples, sem banco)
# formato: { codigo: { empresa_id, empresa_nome, expira_em, usado } }
_convites: dict = {}

def hash_senha(senha: str) -> str:
    return hashlib.sha256(senha.encode()).hexdigest()

def gerar_codigo(tamanho=8):
    chars = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(chars) for _ in range(tamanho))

class UsuarioCreate(BaseModel):
    nome: str
    email: str
    senha: str
    empresa_id: UUID
    perfil: Optional[str] = 'familiar'
    convite: Optional[str] = None

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

class ConviteCreate(BaseModel):
    empresa_id: UUID
    dias_validade: Optional[int] = 7

class ConviteResponse(BaseModel):
    codigo: str
    empresa_id: str
    empresa_nome: str
    expira_em: str
    link: str

@router.post("/convite/gerar", response_model=ConviteResponse)
def gerar_convite(dados: ConviteCreate, db: Session = Depends(get_db)):
    empresa = db.query(Empresa).filter(Empresa.id == dados.empresa_id).first()
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada")
    codigo = gerar_codigo()
    expira = datetime.now(timezone.utc) + timedelta(days=dados.dias_validade or 7)
    _convites[codigo] = {
        "empresa_id": str(dados.empresa_id),
        "empresa_nome": empresa.nome,
        "expira_em": expira.isoformat(),
        "usado": False,
    }
    print(f"[CONVITE] Gerado {codigo} para {empresa.nome} valido ate {expira.date()}", flush=True)
    return ConviteResponse(
        codigo=codigo,
        empresa_id=str(dados.empresa_id),
        empresa_nome=empresa.nome,
        expira_em=expira.isoformat(),
        link=f"https://vms-platform-vmc2.vercel.app/login?convite={codigo}"
    )

@router.get("/convite/{codigo}")
def verificar_convite(codigo: str, db: Session = Depends(get_db)):
    convite = _convites.get(codigo.upper())
    if not convite:
        raise HTTPException(status_code=404, detail="Convite invalido")
    if convite["usado"]:
        raise HTTPException(status_code=400, detail="Convite ja utilizado")
    expira = datetime.fromisoformat(convite["expira_em"])
    if datetime.now(timezone.utc) > expira:
        raise HTTPException(status_code=400, detail="Convite expirado")
    return {
        "valido": True,
        "empresa_id": convite["empresa_id"],
        "empresa_nome": convite["empresa_nome"],
        "expira_em": convite["expira_em"],
    }

@router.post("/registrar", response_model=UsuarioResponse)
def registrar(dados: UsuarioCreate, db: Session = Depends(get_db)):
    # Valida convite se fornecido
    if dados.convite:
        codigo = dados.convite.upper()
        convite = _convites.get(codigo)
        if not convite:
            raise HTTPException(status_code=400, detail="Convite invalido")
        if convite["usado"]:
            raise HTTPException(status_code=400, detail="Convite ja utilizado")
        expira = datetime.fromisoformat(convite["expira_em"])
        if datetime.now(timezone.utc) > expira:
            raise HTTPException(status_code=400, detail="Convite expirado")
        # Forca empresa_id do convite
        dados.empresa_id = UUID(convite["empresa_id"])
        convite["usado"] = True

    existente = db.query(Usuario).filter(Usuario.email == dados.email).first()
    if existente:
        raise HTTPException(status_code=400, detail="Email ja cadastrado")
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
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")
    db.delete(usuario)
    db.commit()
    return {"ok": True}

@router.patch("/usuarios/{usuario_id}", response_model=UsuarioResponse)
def atualizar_usuario(usuario_id: UUID, dados: dict, db: Session = Depends(get_db)):
    usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")
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
        raise HTTPException(status_code=401, detail="Token invalido")
    return {"mensagem": "autenticado", "token": token}