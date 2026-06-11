from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
import uuid
import subprocess
import os
import threading
import time

from app.database import get_db
from app.models.models import Camera

router = APIRouter()

processos_ffmpeg: dict[str, subprocess.Popen] = {}

# Cache de frames HTTP por camera: {camera_id: {"data": bytes, "ts": float}}
_http_cache: dict = {}
_http_cache_lock = __import__("threading").Lock()

def _worker_http_cache(camera_id: str, http_url: str):
    import urllib.request, base64, urllib.parse, threading, time
    parsed = urllib.parse.urlparse(http_url)
    clean_url = http_url
    creds = None
    if parsed.username:
        creds = base64.b64encode(f"{parsed.username}:{parsed.password}".encode()).decode()
        clean_url = http_url.replace(f"{parsed.username}:{parsed.password}@", "")

    print(f"[HTTP CACHE] Worker iniciado para {camera_id}", flush=True)
    while _http_cache.get(camera_id, {}).get("ativo"):
        try:
            req2 = urllib.request.Request(clean_url)
            if creds:
                req2.add_header("Authorization", "Basic " + creds)
            r2 = urllib.request.urlopen(req2, timeout=3)
            data = r2.read()
            if len(data) > 1000:
                with _http_cache_lock:
                    _http_cache[camera_id]["data"] = data
                    _http_cache[camera_id]["ts"] = time.time()
        except Exception as e:
            pass
        time.sleep(0.2)  # 5fps
    print(f"[HTTP CACHE] Worker encerrado para {camera_id}", flush=True)

def iniciar_http_cache(camera_id: str, http_url: str):
    import threading
    with _http_cache_lock:
        if _http_cache.get(camera_id, {}).get("ativo"):
            return
        _http_cache[camera_id] = {"ativo": True, "data": None, "ts": 0}
    t = threading.Thread(target=_worker_http_cache, args=(camera_id, http_url), daemon=True)
    t.start()

class CameraCreate(BaseModel):
    nome: str
    rtsp_url: str
    http_url: Optional[str] = None
    empresa_id: UUID

class CameraResponse(BaseModel):
    id: UUID
    nome: str
    rtsp_url: str
    http_url: Optional[str] = None
    ativo: bool
    empresa_id: UUID

    class Config:
        from_attributes = True

@router.get("/ping")
def ping():
    return {"ok": True}

@router.get("/", response_model=list[CameraResponse])
def listar_cameras(db: Session = Depends(get_db)):
    cameras = db.query(Camera).all()
    for c in cameras:
        if c.ativo and c.http_url:
            iniciar_http_cache(str(c.id), c.http_url)
    return cameras

@router.post("/", response_model=CameraResponse)
def criar_camera(camera: CameraCreate, db: Session = Depends(get_db)):
    nova = Camera(
        id=uuid.uuid4(),
        nome=camera.nome,
        rtsp_url=camera.rtsp_url,
        http_url=camera.http_url,
        empresa_id=camera.empresa_id,
    )
    db.add(nova)
    db.commit()
    db.refresh(nova)
    return nova

@router.get("/{camera_id}", response_model=CameraResponse)
def buscar_camera(camera_id: UUID, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="CÃ¢mera nÃ£o encontrada")
    return camera

@router.delete("/{camera_id}")
def deletar_camera(camera_id: UUID, db: Session = Depends(get_db)):
    return _fazer_delete(camera_id, db)

class RemoverCamera(BaseModel):
    camera_id: UUID

@router.post("/remover")
def remover_camera(body: RemoverCamera, db: Session = Depends(get_db)):
    """Rota POST para remover cÃ¢mera â€” ID no body."""
    return _fazer_delete(body.camera_id, db)

def _fazer_delete(camera_id: UUID, db: Session):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="CÃ¢mera nÃ£o encontrada")
    cid = str(camera_id)

    # Para processos
    try:
        if cid in processos_ffmpeg:
            processos_ffmpeg[cid].kill()
            del processos_ffmpeg[cid]
    except:
        pass

    # Deleta registros relacionados via SQL direto (mais rÃ¡pido que ORM)
    try:
        db.execute(text("DELETE FROM eventos WHERE camera_id = :id"), {"id": cid})
        db.execute(text("DELETE FROM heatmap_pontos WHERE camera_id = :id"), {"id": cid})
        db.execute(text("DELETE FROM regioes_monitoradas WHERE camera_id = :id"), {"id": cid})
        db.execute(text("DELETE FROM linhas_contagem WHERE camera_id = :id"), {"id": cid})
        db.execute(text("DELETE FROM cameras WHERE id = :id"), {"id": cid})
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    return {"mensagem": "CÃ¢mera removida"}

# â”€â”€ SNAPSHOT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/{camera_id}/live")
def live_frame(camera_id: UUID, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if camera and camera.http_url:
        try:
            import urllib.request, base64, urllib.parse
            parsed = urllib.parse.urlparse(camera.http_url)
            clean_url = camera.http_url
            creds = None
            if parsed.username:
                creds = base64.b64encode(f"{parsed.username}:{parsed.password}".encode()).decode()
                clean_url = camera.http_url.replace(f"{parsed.username}:{parsed.password}@", "")
            req2 = urllib.request.Request(clean_url)
            if creds:
                req2.add_header("Authorization", "Basic " + creds)
            r2 = urllib.request.urlopen(req2, timeout=3)
            data = r2.read()
            if len(data) > 1000:
                return Response(content=data, media_type="image/jpeg",
                               headers={"Cache-Control": "no-cache", "X-Source": "http"})
        except:
            pass
    live_path = f"/tmp/live_{camera_id}.jpg"
    if os.path.exists(live_path):
        return Response(content=open(live_path, "rb").read(), media_type="image/jpeg",
                       headers={"Cache-Control": "no-cache"})
    raise HTTPException(status_code=503, detail="Frame nao disponivel ainda")

@router.get("/{camera_id}/stream/mjpeg")
async def mjpeg_proxy(camera_id: UUID, db: Session = Depends(get_db)):
    """Proxy MJPEG - conecta na camera HTTP e repassa stream direto."""
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera or not camera.http_url:
        raise HTTPException(status_code=404, detail="Camera sem HTTP URL")

    import urllib.request, base64, urllib.parse, asyncio

    parsed = urllib.parse.urlparse(camera.http_url)
    # Monta URL de stream MJPEG da Intelbras
    creds = None
    if parsed.username:
        creds = base64.b64encode(f"{parsed.username}:{parsed.password}".encode()).decode()

    snapshot_url = f"http://{parsed.hostname}:{parsed.port}/cgi-bin/snapshot.cgi?channel=1"
    import queue, threading, time

    frame_queue = queue.Queue(maxsize=3)

    def fetch_frames():
        while True:
            try:
                req2 = urllib.request.Request(snapshot_url)
                if creds:
                    req2.add_header("Authorization", "Basic " + creds)
                r2 = urllib.request.urlopen(req2, timeout=3)
                frame = r2.read()
                if len(frame) > 1000:
                    if frame_queue.full():
                        try: frame_queue.get_nowait()
                        except: pass
                    frame_queue.put(frame)
            except Exception as e:
                time.sleep(0.5)

    # Inicia 3 threads paralelas para buscar frames
    for _ in range(3):
        threading.Thread(target=fetch_frames, daemon=True).start()

    def generate():
        while True:
            try:
                frame = frame_queue.get(timeout=5)
                yield (
                    b"--myboundary\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n" +
                    frame + b"\r\n"
                )
            except:
                break

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=myboundary",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"}
    )

@router.get("/{camera_id}/snapshot")
def snapshot(camera_id: UUID, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="CÃ¢mera nÃ£o encontrada")

    try:
        resultado = subprocess.run([
            "ffmpeg", "-y",
            "-rtsp_transport", "tcp",
            "-i", camera.rtsp_url,
            "-frames:v", "1",
            "-q:v", "5",
            "-f", "image2",
            "-vcodec", "mjpeg",
            "pipe:1"
        ], timeout=10, capture_output=True)

        if resultado.returncode == 0 and len(resultado.stdout) > 1000:
            return Response(
                content=resultado.stdout,
                media_type="image/jpeg",
                headers={"Cache-Control": "no-cache"}
            )
        raise HTTPException(status_code=502, detail="CÃ¢mera nÃ£o respondeu")

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Timeout")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# â”€â”€ HLS STREAM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        try:
            processos_ffmpeg[camera_id].kill()
        except:
            pass
        del processos_ffmpeg[camera_id]

async def _gerar_mjpeg_async(rtsp_url: str):
    """Async generator que produz frames MJPEG via asyncio subprocess."""
    import asyncio
    SOI = b"\xff\xd8"
    EOI = b"\xff\xd9"

    while True:
        proc = None
        try:
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg",
                "-rtsp_transport", "tcp",
                "-i", rtsp_url,
                "-vf", "fps=15,scale=1280:-1",
                "-q:v", "5",
                "-f", "image2pipe",
                "-vcodec", "mjpeg",
                "pipe:1",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL
            )

            buffer = b""
            while True:
                chunk = await proc.stdout.read(16384)
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
                        yield (
                            b"--frame\r\n"
                            b"Content-Type: image/jpeg\r\n"
                            b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n" +
                            frame + b"\r\n"
                        )

        except Exception as e:
            print(f"[MJPEG] Erro: {e}", flush=True)
        finally:
            if proc:
                try:
                    proc.terminate()
                except:
                    pass
        await asyncio.sleep(2)

@router.get("/{camera_id}/stream/mjpeg")
async def stream_mjpeg(camera_id: UUID, db: Session = Depends(get_db)):
    """Endpoint MJPEG async â€” stream contÃ­nuo de frames a 15fps sem bloquear."""
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="CÃ¢mera nÃ£o encontrada")

    return StreamingResponse(
        _gerar_mjpeg_async(camera.rtsp_url),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"}
    )

@router.post("/{camera_id}/stream/iniciar")
def iniciar_stream(camera_id: UUID, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="CÃ¢mera nÃ£o encontrada")
    cid = str(camera_id)
    if cid in processos_ffmpeg and processos_ffmpeg[cid].poll() is None:
        return {"status": "jÃ¡ rodando", "playlist": f"/cameras/{cid}/stream/playlist"}
    iniciar_ffmpeg(cid, camera.rtsp_url)
    pasta = f"/tmp/hls_{cid}"
    for _ in range(16):
        if os.path.exists(f"{pasta}/stream.m3u8"):
            break
        time.sleep(0.5)
    else:
        parar_stream(cid)
        raise HTTPException(status_code=502, detail="FFmpeg nÃ£o conseguiu conectar")
    return {"status": "iniciado", "playlist": f"/cameras/{cid}/stream/playlist"}

@router.get("/{camera_id}/stream/playlist")
def servir_playlist(camera_id: UUID):
    cid = str(camera_id)
    caminho = f"/tmp/hls_{cid}/stream.m3u8"
    if not os.path.exists(caminho):
        raise HTTPException(status_code=404, detail="Stream nÃ£o iniciado")
    return FileResponse(caminho, media_type="application/vnd.apple.mpegurl",
                        headers={"Cache-Control": "no-cache"})

@router.get("/{camera_id}/stream/{segmento}")
def servir_segmento(camera_id: UUID, segmento: str):
    cid = str(camera_id)
    caminho = f"/tmp/hls_{cid}/{segmento}"
    if not os.path.exists(caminho):
        raise HTTPException(status_code=404, detail="Segmento nÃ£o encontrado")
    return FileResponse(caminho, media_type="video/mp2t")

@router.post("/{camera_id}/stream/parar")
def parar_stream_endpoint(camera_id: UUID):
    parar_stream(str(camera_id))
    return {"status": "parado"}

@router.get("/streams/status")
def status_streams():
    return {cid: processos_ffmpeg[cid].poll() is None for cid in processos_ffmpeg}


