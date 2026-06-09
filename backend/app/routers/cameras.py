from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse, Response
from sqlalchemy.orm import Session
from pydantic import BaseModel
from uuid import UUID
import uuid
import subprocess
import os
import threading
import time

from app.database import get_db
from app.models.models import Camera

router = APIRouter()

# ─────────────────────────────────────────────
# CACHE DE SNAPSHOTS (atualiza em background)
# ─────────────────────────────────────────────
# {camera_id: {"data": bytes, "ts": float, "rodando": bool}}
_snapshot_cache: dict = {}
_cache_lock = threading.Lock()

def _worker_snapshot(camera_id: str, rtsp_url: str):
    """
    Mantém conexão RTSP aberta e extrai frames continuamente via pipe.
    Muito mais rápido que abrir/fechar conexão a cada snapshot.
    """
    print(f"[SNAPSHOT] Worker iniciado para câmera {camera_id}", flush=True)

    SOI = b"\xff\xd8"
    EOI = b"\xff\xd9"

    while True:
        with _cache_lock:
            if not _snapshot_cache.get(camera_id, {}).get("rodando"):
                break

        proc = None
        try:
            proc = subprocess.Popen([
                "ffmpeg",
                "-rtsp_transport", "tcp",
                "-i", rtsp_url,
                "-vf", "fps=1",
                "-q:v", "6",
                "-f", "image2pipe",
                "-vcodec", "mjpeg",
                "pipe:1"
            ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

            print(f"[SNAPSHOT] Conexão RTSP aberta para {camera_id}", flush=True)

            buffer = b""
            while True:
                with _cache_lock:
                    if not _snapshot_cache.get(camera_id, {}).get("rodando"):
                        proc.terminate()
                        return

                chunk = proc.stdout.read(8192)
                if not chunk:
                    break

                buffer += chunk

                while True:
                    start = buffer.find(SOI)
                    if start == -1:
                        buffer = b""
                        break
                    end = buffer.find(EOI, start)
                    if end == -1:
                        buffer = buffer[start:]
                        break
                    frame = buffer[start:end + 2]
                    buffer = buffer[end + 2:]
                    if len(frame) > 1000:
                        with _cache_lock:
                            if camera_id in _snapshot_cache:
                                _snapshot_cache[camera_id]["data"] = frame
                                _snapshot_cache[camera_id]["ts"]   = time.time()

            print(f"[SNAPSHOT] Conexão encerrada para {camera_id}, reconectando...", flush=True)

        except Exception as e:
            print(f"[SNAPSHOT] Erro câmera {camera_id}: {e}", flush=True)
        finally:
            if proc:
                try:
                    proc.terminate()
                except:
                    pass

        time.sleep(3)

    print(f"[SNAPSHOT] Worker encerrado para câmera {camera_id}", flush=True)


def iniciar_cache_snapshot(camera_id: str, rtsp_url: str):
    """Inicia o worker de cache para uma câmera."""
    with _cache_lock:
        info = _snapshot_cache.get(camera_id, {})
        if info.get("rodando"):
            return  # já está rodando
        _snapshot_cache[camera_id] = {"data": None, "ts": 0, "rodando": True}

    t = threading.Thread(
        target=_worker_snapshot,
        args=(camera_id, rtsp_url),
        daemon=True
    )
    t.start()

def parar_cache_snapshot(camera_id: str):
    """Para o worker de cache de uma câmera."""
    with _cache_lock:
        if camera_id in _snapshot_cache:
            _snapshot_cache[camera_id]["rodando"] = False

# ─────────────────────────────────────────────
# HLS STREAMS
# ─────────────────────────────────────────────
processos_ffmpeg: dict[str, subprocess.Popen] = {}

class CameraCreate(BaseModel):
    nome: str
    rtsp_url: str
    empresa_id: UUID

class CameraResponse(BaseModel):
    id: UUID
    nome: str
    rtsp_url: str
    ativo: bool
    empresa_id: UUID

    class Config:
        from_attributes = True

@router.get("/", response_model=list[CameraResponse])
def listar_cameras(db: Session = Depends(get_db)):
    cameras = db.query(Camera).all()
    # Inicia cache de snapshot para todas câmeras ativas
    for c in cameras:
        if c.ativo:
            iniciar_cache_snapshot(str(c.id), c.rtsp_url)
    return cameras

@router.post("/", response_model=CameraResponse)
def criar_camera(camera: CameraCreate, db: Session = Depends(get_db)):
    nova = Camera(
        id=uuid.uuid4(),
        nome=camera.nome,
        rtsp_url=camera.rtsp_url,
        empresa_id=camera.empresa_id,
    )
    db.add(nova)
    db.commit()
    db.refresh(nova)
    iniciar_cache_snapshot(str(nova.id), nova.rtsp_url)
    return nova

@router.get("/{camera_id}", response_model=CameraResponse)
def buscar_camera(camera_id: UUID, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Câmera não encontrada")
    return camera

@router.delete("/{camera_id}")
def deletar_camera(camera_id: UUID, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Câmera não encontrada")

    # Deleta do banco imediatamente
    db.delete(camera)
    db.commit()

    # Para processos em background (não bloqueia a resposta)
    def _parar():
        try:
            parar_stream(str(camera_id))
        except:
            pass
        try:
            parar_cache_snapshot(str(camera_id))
        except:
            pass

    threading.Thread(target=_parar, daemon=True).start()

    return {"mensagem": "Câmera removida"}

# ── SNAPSHOT ──────────────────────────────────────────────────────────────────

@router.get("/{camera_id}/snapshot")
def snapshot(camera_id: UUID, db: Session = Depends(get_db)):
    """
    Retorna o último frame em cache (resposta imediata).
    Se não houver cache ainda, captura um frame na hora.
    """
    cid = str(camera_id)

    # Verifica cache primeiro
    with _cache_lock:
        info = _snapshot_cache.get(cid, {})
        dados = info.get("data")

    if dados:
        return Response(
            content=dados,
            media_type="image/jpeg",
            headers={"Cache-Control": "no-cache", "X-From-Cache": "true"}
        )

    # Cache ainda não tem frame — captura na hora e inicia worker
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Câmera não encontrada")

    iniciar_cache_snapshot(cid, camera.rtsp_url)

    try:
        resultado = subprocess.run([
            "ffmpeg", "-y",
            "-rtsp_transport", "tcp",
            "-i", camera.rtsp_url,
            "-frames:v", "1",
            "-q:v", "4",
            "-f", "image2",
            "-vcodec", "mjpeg",
            "pipe:1"
        ], timeout=10, capture_output=True)

        if resultado.returncode == 0 and len(resultado.stdout) > 0:
            with _cache_lock:
                if cid in _snapshot_cache:
                    _snapshot_cache[cid]["data"] = resultado.stdout
                    _snapshot_cache[cid]["ts"]   = time.time()
            return Response(
                content=resultado.stdout,
                media_type="image/jpeg",
                headers={"Cache-Control": "no-cache"}
            )

        raise HTTPException(status_code=502, detail="Câmera não respondeu")

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Timeout ao conectar na câmera")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── HLS STREAM ────────────────────────────────────────────────────────────────

def iniciar_ffmpeg(camera_id: str, rtsp_url: str):
    pasta = f"/tmp/hls_{camera_id}"
    os.makedirs(pasta, exist_ok=True)

    processo = subprocess.Popen([
        "ffmpeg", "-y",
        "-rtsp_transport", "tcp",
        "-i", rtsp_url,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-c:a", "aac",
        "-f", "hls",
        "-hls_time", "2",
        "-hls_list_size", "5",
        "-hls_flags", "delete_segments",
        f"{pasta}/stream.m3u8"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    processos_ffmpeg[camera_id] = processo
    return processo

def parar_stream(camera_id: str):
    if camera_id in processos_ffmpeg:
        processos_ffmpeg[camera_id].terminate()
        del processos_ffmpeg[camera_id]

@router.post("/{camera_id}/stream/iniciar")
def iniciar_stream(camera_id: UUID, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Câmera não encontrada")

    cid = str(camera_id)

    if cid in processos_ffmpeg and processos_ffmpeg[cid].poll() is None:
        return {"status": "já rodando", "playlist": f"/cameras/{cid}/stream/playlist"}

    iniciar_ffmpeg(cid, camera.rtsp_url)

    pasta = f"/tmp/hls_{cid}"
    for _ in range(16):
        if os.path.exists(f"{pasta}/stream.m3u8"):
            break
        time.sleep(0.5)
    else:
        parar_stream(cid)
        raise HTTPException(status_code=502, detail="FFmpeg não conseguiu conectar na câmera")

    return {"status": "iniciado", "playlist": f"/cameras/{cid}/stream/playlist"}

@router.get("/{camera_id}/stream/playlist")
def servir_playlist(camera_id: UUID):
    cid = str(camera_id)
    caminho = f"/tmp/hls_{cid}/stream.m3u8"
    if not os.path.exists(caminho):
        raise HTTPException(status_code=404, detail="Stream não iniciado")
    return FileResponse(caminho, media_type="application/vnd.apple.mpegurl",
                        headers={"Cache-Control": "no-cache"})

@router.get("/{camera_id}/stream/{segmento}")
def servir_segmento(camera_id: UUID, segmento: str):
    cid = str(camera_id)
    caminho = f"/tmp/hls_{cid}/{segmento}"
    if not os.path.exists(caminho):
        raise HTTPException(status_code=404, detail="Segmento não encontrado")
    return FileResponse(caminho, media_type="video/mp2t")

@router.post("/{camera_id}/stream/parar")
def parar_stream_endpoint(camera_id: UUID):
    parar_stream(str(camera_id))
    return {"status": "parado"}

@router.get("/streams/status")
def status_streams():
    return {
        cid: processos_ffmpeg[cid].poll() is None
        for cid in processos_ffmpeg
    }
