from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from urllib.parse import parse_qs
from app.mediamtx_auth import validar_rtsp_token, validar_publish_secret

router = APIRouter()


class MediaMTXAuthRequest(BaseModel):
    user: Optional[str] = ""
    password: Optional[str] = ""
    ip: Optional[str] = ""
    action: Optional[str] = ""
    path: Optional[str] = ""
    protocol: Optional[str] = ""
    id: Optional[str] = ""
    query: Optional[str] = ""


@router.post("/auth")
def autenticar(dados: MediaMTXAuthRequest):
    """Webhook de autenticacao do MediaMTX (authHTTPAddress).
    O ffmpeg nao reenvia credenciais apos o desafio 401 do RTSP ao publicar,
    entao o publisher (worker.py) manda usuario/senha via query string em vez
    de user:pass@host - por isso aceitamos credenciais tanto nos campos
    user/password quanto na query.
    """
    usuario = dados.user or ""
    senha = dados.password or ""
    if not usuario and not senha and dados.query:
        qs = parse_qs(dados.query)
        usuario = (qs.get("user") or [""])[0]
        senha = (qs.get("pass") or [""])[0]

    if not usuario and not senha:
        raise HTTPException(status_code=401, detail="Credenciais necessarias")

    camera_id = (dados.path or "").strip("/")

    if dados.action == "publish":
        if validar_publish_secret(senha):
            return {"ok": True}
        raise HTTPException(status_code=403, detail="Segredo de publish invalido")

    if dados.action in ("read", "playback"):
        if camera_id and validar_rtsp_token(camera_id, senha):
            return {"ok": True}
        raise HTTPException(status_code=403, detail="Token de leitura invalido ou expirado")

    raise HTTPException(status_code=403, detail="Acao nao permitida")
