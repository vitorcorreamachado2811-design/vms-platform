from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
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
    RTSP nao envia credenciais na primeira tentativa - responder 401 nesse caso
    para o cliente reenviar com usuario/senha embutidos na URL.
    """
    if not dados.user and not dados.password:
        raise HTTPException(status_code=401, detail="Credenciais necessarias")

    camera_id = (dados.path or "").strip("/")

    if dados.action == "publish":
        if validar_publish_secret(dados.password or ""):
            return {"ok": True}
        raise HTTPException(status_code=403, detail="Segredo de publish invalido")

    if dados.action in ("read", "playback"):
        if camera_id and validar_rtsp_token(camera_id, dados.password or ""):
            return {"ok": True}
        raise HTTPException(status_code=403, detail="Token de leitura invalido ou expirado")

    raise HTTPException(status_code=403, detail="Acao nao permitida")
