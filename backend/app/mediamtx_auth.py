import hashlib
import hmac
import os
import time

RTSP_TOKEN_SECRET = os.environ.get("RTSP_TOKEN_SECRET", "")
MEDIAMTX_PUBLISH_SECRET = os.environ.get("MEDIAMTX_PUBLISH_SECRET", "")

RTSP_TOKEN_TTL_SEGUNDOS = 300


def gerar_rtsp_token(camera_id: str, ttl_segundos: int = RTSP_TOKEN_TTL_SEGUNDOS) -> str:
    """Gera um token HMAC de curta duracao para leitura RTSP de uma camera.
    Formato: {expira_em_unix}.{assinatura}
    """
    expira_em = int(time.time()) + ttl_segundos
    assinatura = _assinar(camera_id, expira_em)
    return f"{expira_em}.{assinatura}"


def validar_rtsp_token(camera_id: str, token: str) -> bool:
    """Valida um token gerado por gerar_rtsp_token para a mesma camera_id."""
    if not token or "." not in token:
        return False
    try:
        expira_str, assinatura_recebida = token.split(".", 1)
        expira_em = int(expira_str)
    except ValueError:
        return False
    if time.time() > expira_em:
        return False
    assinatura_esperada = _assinar(camera_id, expira_em)
    return hmac.compare_digest(assinatura_esperada, assinatura_recebida)


def validar_publish_secret(senha: str) -> bool:
    if not MEDIAMTX_PUBLISH_SECRET or not senha:
        return False
    return hmac.compare_digest(MEDIAMTX_PUBLISH_SECRET, senha)


def _assinar(camera_id: str, expira_em: int) -> str:
    mensagem = f"{camera_id}:{expira_em}".encode()
    return hmac.new(RTSP_TOKEN_SECRET.encode(), mensagem, hashlib.sha256).hexdigest()
