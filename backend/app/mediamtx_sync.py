"""
mediamtx_sync.py - Sincroniza cameras do banco escrevendo mediamtx.yml e
reiniciando o MediaMTX via Docker SDK (unico jeito confiavel no v1.19.2).
"""
import os
import re
import docker
from sqlalchemy.orm import Session
from app.models.models import Camera

MEDIAMTX_YML = os.environ.get("MEDIAMTX_YML_PATH", "/mediamtx-config/mediamtx.yml")
MEDIAMTX_AUTH_URL = os.environ.get("MEDIAMTX_AUTH_URL", "http://backend:8000/mediamtx/auth")

# DVRs que enviam H264 com B-frames — precisam de transcoding via ffmpeg
# para que o WebRTC consiga reproduzir (WebRTC nao suporta B-frames).
BFRAME_DVR_IPS = {"177.74.74.254"}

def _rtsp_substream(rtsp_url: str) -> str:
    """Usa subtype=1 (stream extra, 352x240, leve) pra visualizacao ao vivo."""
    return re.sub(r"subtype=\d+", "subtype=1", rtsp_url)

def _dvr_ip(rtsp_url: str) -> str:
    m = re.search(r"@([^:/]+)", rtsp_url)
    return m.group(1) if m else ""

def _gerar_yml(cameras) -> str:
    linhas = [
        "# Gerado automaticamente pelo backend - nao editar manualmente",
        "api: yes",
        "apiAddress: :9997",
        "authMethod: http",
        f"authHTTPAddress: {MEDIAMTX_AUTH_URL}",
        "authHTTPExclude:",
        "  - action: api",
        "  - action: metrics",
        "  - action: pprof",
        "  - action: publish",
        "webrtcAdditionalHosts: [177.136.230.76]",
        "webrtcLocalUDPAddress: :8189",
        "paths:",
    ]
    for cam in cameras:
        if not cam.rtsp_url or not cam.ativo:
            continue
        url = _rtsp_substream(cam.rtsp_url)
        ip = _dvr_ip(url)
        linhas.append(f"  {cam.id}:")
        if ip in BFRAME_DVR_IPS:
            # DVR com B-frames: usa stream principal (subtype=0) pois tem
            # timestamps corretos. O substream deste DVR envia frames sem
            # timestamps RTP validos, causando freeze no WebRTC.
            url_main = re.sub(r"subtype=\d+", "subtype=0", cam.rtsp_url)
            ffmpeg_cmd = (
                f"ffmpeg -rtsp_transport tcp -i '{url_main}' "
                f"-c:v libx264 -profile:v baseline -preset ultrafast "
                f"-tune zerolatency -an "
                f"-f rtsp rtsp://127.0.0.1:8554/{cam.id}"
            )
            linhas += [
                f"    runOnDemand: {ffmpeg_cmd}",
                f"    runOnDemandStartTimeout: 30s",
                f"    runOnDemandRestart: yes",
                f"    runOnDemandCloseAfter: 60s",
            ]
        else:
            linhas += [
                f"    source: {url}",
                f"    sourceOnDemand: yes",
                f"    sourceOnDemandCloseAfter: 60s",
                f"    rtspTransport: tcp",
            ]
    linhas.append("  all_others: {}")
    return "\n".join(linhas) + "\n"

async def sincronizar_mediamtx(db: Session):
    try:
        cameras = db.query(Camera).filter(Camera.ativo == True).all()
        conteudo = _gerar_yml(cameras)
        with open(MEDIAMTX_YML, "w", encoding="utf-8") as f:
            f.write(conteudo)
        client = docker.from_env()
        container = client.containers.get("mediamtx")
        container.restart(timeout=5)
        print(f"[MEDIAMTX] Reiniciado com {len(cameras)} cameras", flush=True)
        return True
    except Exception as e:
        print(f"[MEDIAMTX] Erro ao sincronizar: {e}", flush=True)
        return False
