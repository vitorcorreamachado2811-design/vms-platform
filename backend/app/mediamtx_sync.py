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

def _rtsp_substream(rtsp_url: str) -> str:
    """Usa subtype=1 (stream extra, 352x240, leve) pra visualizacao ao vivo."""
    return re.sub(r"subtype=\d+", "subtype=1", rtsp_url)

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
        "webrtcAdditionalHosts: [177.136.230.76]",
        "webrtcICEUDPMuxAddress: :8189",
        "paths:",
    ]
    for cam in cameras:
        if not cam.rtsp_url or not cam.ativo:
            continue
        url = _rtsp_substream(cam.rtsp_url)
        linhas += [
            f"  {cam.id}:",
            f"    source: {url}",
            f"    sourceOnDemand: yes",
            f"    sourceOnDemandCloseAfter: 10s",
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
        # Reinicia o container mediamtx via Docker SDK
        client = docker.from_env()
        container = client.containers.get("mediamtx")
        container.restart(timeout=5)
        print(f"[MEDIAMTX] Reiniciado com {len(cameras)} cameras", flush=True)
        return True
    except Exception as e:
        print(f"[MEDIAMTX] Erro ao sincronizar: {e}", flush=True)
        return False
