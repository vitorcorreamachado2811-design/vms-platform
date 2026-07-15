"""
mediamtx_sync.py - Sincroniza cameras do banco com o mediamtx.yml.

O MediaMTX monitora o arquivo e recarrega automaticamente quando ele muda.
Cada camera recebe um path com runOnDemand: o MediaMTX executa o ffmpeg apenas
quando alguem pede o stream, e mata quando o ultimo viewer sai.
"""
import os
import re
from sqlalchemy.orm import Session
from app.models.models import Camera

MEDIAMTX_YML = os.environ.get("MEDIAMTX_YML_PATH", "/mediamtx-config/mediamtx.yml")
MEDIAMTX_PUBLISH_SECRET = os.environ.get("MEDIAMTX_PUBLISH_SECRET", "")
MEDIAMTX_HOSTNAME = os.environ.get("MEDIAMTX_HOSTNAME", "mediamtx")
MEDIAMTX_AUTH_URL = os.environ.get("MEDIAMTX_AUTH_URL", "http://backend:8000/mediamtx/auth")

def _rtsp_main(rtsp_url: str) -> str:
    """Troca subtype=1 por subtype=0 (stream principal, qualidade boa pro viewer)."""
    return re.sub(r'subtype=\d+', 'subtype=0', rtsp_url)

def _cmd_runOnDemand(camera_id: str, rtsp_url: str) -> str:
    destino = f"rtmp://{MEDIAMTX_HOSTNAME}:1935/{camera_id}?user=publisher&pass={MEDIAMTX_PUBLISH_SECRET}"
    url_main = _rtsp_main(rtsp_url)
    return (
        f"ffmpeg -rtsp_transport tcp -i {url_main} "
        f"-c:v copy -f flv {destino}"
    )

def _gerar_yml(cameras) -> str:
    linhas = [
        "# Gerado automaticamente pelo backend - nao editar manualmente",
        "authMethod: http",
        f"authHTTPAddress: {MEDIAMTX_AUTH_URL}",
        "authHTTPExclude:",
        "  - action: api",
        "  - action: metrics",
        "  - action: pprof",
        "webrtcAdditionalHosts: [177.136.230.76]",
        "webrtcICEUDPMuxAddress: :8189",
        "paths:",
    ]
    for cam in cameras:
        if not cam.rtsp_url or not cam.ativo:
            continue
        cmd = _cmd_runOnDemand(str(cam.id), cam.rtsp_url)
        linhas += [
            f"  {cam.id}:",
            f"    runOnDemand: {cmd}",
            f"    runOnDemandCloseAfter: 10s",
        ]
    linhas.append("  all_others: {}")
    return "\n".join(linhas) + "\n"

async def sincronizar_mediamtx(db: Session):
    try:
        cameras = db.query(Camera).filter(Camera.ativo == True).all()
        conteudo = _gerar_yml(cameras)
        with open(MEDIAMTX_YML, "w", encoding="utf-8") as f:
            f.write(conteudo)
        print(f"[MEDIAMTX] mediamtx.yml atualizado: {len(cameras)} cameras", flush=True)
        return True
    except Exception as e:
        print(f"[MEDIAMTX] Erro ao sincronizar: {e}", flush=True)
        return False
