from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from fastapi.responses import Response, StreamingResponse
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
import asyncio
import io
from app.database import get_db
from app.models.models import Camera

router = APIRouter()

processos_ffmpeg: dict = {}

# Cache de frames HTTP por camera
_http_cache: dict = {}
_http_cache_lock = threading.Lock()

# Store de frames ao vivo em memoria (via POST do worker)
_frames_live: dict = {}
_frames_ts: dict = {}


def _worker_http_cache(camera_id: str, http_url: str):
    import urllib.request, base64, urllib.parse
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
        except Exception:
            pass
        time.sleep(0.2)
    print(f"[HTTP CACHE] Worker encerrado para {camera_id}", flush=True)


def iniciar_http_cache(camera_id: str, http_url: str):
    with _http_cache_lock:
        if _http_cache.get(camera_id, {}).get("ativo"):
            return
        _http_cache[camera_id] = {"ativo": True, "data": None, "ts": 0}
    t = threading.Thread(target=_worker_http_cache, args=(camera_id, http_url), daemon=True)
    t.start()


def _make_no_signal_frame(camera_id: str) -> bytes:
    """Gera frame JPEG de sem sinal sem dependencias externas."""
    try:
        from PIL import Image, ImageDraw
        img = Image.new("RGB", (1280, 720), color=(12, 12, 18))
        draw = ImageDraw.Draw(img)
        cx, cy = 640, 300
        # Icone camera
        draw.rounded_rectangle([cx-70, cy-45, cx+70, cy+45], radius=10, outline=(70, 70, 90), width=3)
        draw.ellipse([cx-28, cy-28, cx+28, cy+28], outline=(70, 70, 90), width=3)
        draw.polygon([(cx+52, cy-50), (cx+90, cy-65), (cx+90, cy+65), (cx+52, cy+50)], outline=(70, 70, 90))
        # Linha diagonal vermelha
        draw.line([cx-90, cy-65, cx+90, cy+65], fill=(160, 40, 40), width=4)
        # Textos
        draw.text((640, 400), "Sem sinal", fill=(190, 190, 205), anchor="mm", font_size=30)
        draw.text((640, 442), camera_id.replace("-", " ").title(), fill=(110, 110, 130), anchor="mm", font_size=18)
        draw.text((640, 478), time.strftime("%H:%M:%S"), fill=(70, 70, 90), anchor="mm", font_size=14)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=75)
        return buf.getvalue()
    except Exception:
        # Fallback: JPEG minimo valido (1x1 preto) caso Pillow nao esteja instalado
        return (
            b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
            b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
            b"\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a"
            b"\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342\x1e"
            b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00"
            b"\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00"
            b"\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b"
            b"\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05\x04"
            b"\x04\x00\x00\x01}\x01\x02\x03\x00\x04\x11\x05\x12!1A\x06\x13Qa"
            b"\x07\"q\x142\x81\x91\xa1\x08#B\xb1\xc1\x15R\xd1\xf0$3br"
            b"\x82\t\n\x16\x17\x18\x19\x1a%&'()*456789:CDEFGHIJ"
            b"STUVWXYZ\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xfb\xd0"
            b"\xff\xd9"
        )


class CameraCreate(BaseModel):
    nome: str
    rtsp_url: str
    http_url: Optional[str] = None
    empresa_id: UUID


class CameraUpdate(BaseModel):
    nome: Optional[str] = None
    rtsp_url: Optional[str] = None
    http_url: Optional[str] = None
    ativo: Optional[bool] = None


class CameraResponse(BaseModel):
    id: UUID
    nome: str
    rtsp_url: str
    http_url: Optional[str] = None
    ativo: bool
    empresa_id: UUID
    class Config:
        from_attributes = True


class RemoverCamera(BaseModel):
    camera_id: UUID


import os

MEDIAMTX_URL  = os.environ.get("MEDIAMTX_URL", "")
MEDIAMTX_RTSP = os.environ.get("MEDIAMTX_RTSP_URL", "rtsp://wonderful-laughter.railway.internal:8554")

# Publisher sob demanda — so roda quando alguem esta assistindo
_publisher_procs: dict  = {}
_publisher_locks: dict  = {}
_publisher_viewers: dict = {}  # {camera_id: count}
_pub_lock = threading.Lock()


def _iniciar_publisher_camera(camera_id: str, rtsp_url: str, nome: str):
    """Inicia o ffmpeg publisher para uma camera especifica."""
    destino = f"{MEDIAMTX_RTSP}/{camera_id}"
    print(f"[PUBLISHER] Iniciando {nome} -> {destino}", flush=True)

    while _publisher_viewers.get(camera_id, 0) > 0:
        proc = None
        try:
            proc = subprocess.Popen([
                "ffmpeg", "-loglevel", "error",
                "-rtsp_transport", "tcp",
                "-i", rtsp_url,
                "-vf", "scale=640:360",
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-tune", "zerolatency",
                "-crf", "30",
                "-maxrate", "500k",
                "-bufsize", "500k",
                "-g", "30",
                "-an",
                "-f", "rtsp",
                "-rtsp_transport", "tcp", destino
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            _publisher_procs[camera_id] = proc

            while _publisher_viewers.get(camera_id, 0) > 0:
                if proc.poll() is not None:
                    break
                time.sleep(2)
        except Exception as e:
            print(f"[PUBLISHER] Erro {nome}: {e}", flush=True)
        finally:
            if proc:
                try: proc.kill()
                except: pass

        if _publisher_viewers.get(camera_id, 0) > 0:
            time.sleep(2)

    print(f"[PUBLISHER] Parando {nome}", flush=True)
    if camera_id in _publisher_procs:
        try: _publisher_procs[camera_id].kill()
        except: pass
        del _publisher_procs[camera_id]


def adicionar_viewer(camera_id: str, rtsp_url: str, nome: str):
    with _pub_lock:
        _publisher_viewers[camera_id] = _publisher_viewers.get(camera_id, 0) + 1
        if _publisher_viewers[camera_id] == 1:
            t = threading.Thread(
                target=_iniciar_publisher_camera,
                args=(camera_id, rtsp_url, nome),
                daemon=True
            )
            t.start()


def remover_viewer(camera_id: str):
    with _pub_lock:
        count = _publisher_viewers.get(camera_id, 0)
        _publisher_viewers[camera_id] = max(0, count - 1)



@router.options("/{camera_id}/webrtc")
async def webrtc_options(camera_id: str):
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
    )

@router.post("/{camera_id}/webrtc")
async def webrtc_proxy(camera_id: str, request: Request, db: Session = Depends(get_db)):
    """
    Proxy WHEP para o MediaMTX.
    Inicia o publisher ffmpeg sob demanda quando alguem abre o player.
    """
    if not MEDIAMTX_URL:
        raise HTTPException(status_code=503, detail="MediaMTX nao configurado")

    # Busca dados da camera para iniciar o publisher
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera nao encontrada")

    # Inicia publisher sob demanda
    adicionar_viewer(camera_id, camera.rtsp_url, camera.nome)

    # Aguarda o stream estar disponivel no MediaMTX (max 10s)
    import urllib.request
    whep_url = f"{MEDIAMTX_URL}/{camera_id}/whep"
    sdp = await request.body()

    for tentativa in range(5):
        try:
            req = urllib.request.Request(
                whep_url,
                data=sdp,
                headers={"Content-Type": "application/sdp"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                answer_sdp = resp.read()
                return Response(
                    content=answer_sdp,
                    media_type="application/sdp",
                    headers={"Access-Control-Allow-Origin": "*"}
                )
        except Exception as e:
            if tentativa < 4:
                time.sleep(2)
            else:
                remover_viewer(camera_id)
                raise HTTPException(status_code=502, detail=f"Erro MediaMTX: {e}")


@router.delete("/{camera_id}/webrtc")
async def webrtc_stop(camera_id: str):
    """Notifica que o viewer fechou o player."""
    remover_viewer(camera_id)
    return {"ok": True}


@router.get("/", response_model=list[CameraResponse])
def listar_cameras(empresa_id: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(Camera)
    if empresa_id:
        query = query.filter(Camera.empresa_id == empresa_id)
    cameras = query.all()
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
        raise HTTPException(status_code=404, detail="Camera nao encontrada")
    return camera


@router.patch("/{camera_id}", response_model=CameraResponse)
def editar_camera(camera_id: UUID, dados: CameraUpdate, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera nao encontrada")
    if dados.nome is not None:
        camera.nome = dados.nome
    if dados.rtsp_url is not None:
        camera.rtsp_url = dados.rtsp_url
    if dados.http_url is not None:
        camera.http_url = dados.http_url
    if dados.ativo is not None:
        camera.ativo = dados.ativo
    db.commit()
    db.refresh(camera)
    return camera


@router.delete("/{camera_id}")
def deletar_camera(camera_id: UUID, db: Session = Depends(get_db)):
    return _fazer_delete(camera_id, db)


@router.post("/remover")
def remover_camera(body: RemoverCamera, db: Session = Depends(get_db)):
    return _fazer_delete(body.camera_id, db)


def _fazer_delete(camera_id: UUID, db: Session):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera nao encontrada")
    cid = str(camera_id)
    try:
        if cid in processos_ffmpeg:
            processos_ffmpeg[cid].kill()
            del processos_ffmpeg[cid]
    except Exception:
        pass
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
    return {"mensagem": "Camera removida"}


# -- FRAME AO VIVO via worker POST --

@router.post("/{camera_id}/frame")
async def receber_frame(camera_id: str, request: Request):
    """Worker faz POST do frame JPEG aqui."""
    body = await request.body()
    if body:
        _frames_live[camera_id] = body
        _frames_ts[camera_id] = time.time()
    return {"ok": True}


@router.get("/{camera_id}/frame")
def obter_frame(camera_id: str):
    """Frontend busca o ultimo frame."""
    frame = _frames_live.get(camera_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Sem frame")
    return Response(
        content=frame,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "no-cache, no-store, max-age=0",
            "X-Frame-Timestamp": str(_frames_ts.get(camera_id, 0))
        }
    )


# -- MJPEG STREAM DIRETO --

@router.get("/{camera_id}/mjpeg")
async def mjpeg_stream(camera_id: str, db: Session = Depends(get_db)):
    """
    MJPEG stream: uma conexao HTTP continua, frames empurrados pelo servidor.
    Frontend usa <img src=".../mjpeg"> nativo — sem polling, sem JS, delay zero.
    Se o RTSP cair, empurra frame de 'Sem sinal' e tenta reconectar automaticamente.
    """
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera nao encontrada")

    rtsp_url = camera.rtsp_url

    return StreamingResponse(
        _gerar_mjpeg(rtsp_url, camera_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "Access-Control-Allow-Origin": "*",
        }
    )


async def _gerar_mjpeg(rtsp_url: str, camera_id: str):
    """
    Generator assincrono. Roda ffmpeg, extrai frames JPEG do stdout
    e os empurra no formato multipart/x-mixed-replace.
    Reconecta automaticamente se o RTSP cair.
    """
    BOUNDARY = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
    TAIL = b"\r\n"
    SOI = b"\xff\xd8"
    EOI = b"\xff\xd9"

    while True:
        proc = None
        try:
            cmd = [
                "ffmpeg",
                "-loglevel", "error",
                "-rtsp_transport", "tcp",
                "-i", rtsp_url,
                "-f", "image2pipe",
                "-vf", "scale=854:480",
                "-vcodec", "mjpeg",
                "-q:v", "8",
                "-r", "15",
                "-"
            ]

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )

            buffer = b""

            while True:
                chunk = await proc.stdout.read(65536)
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

                    yield BOUNDARY + frame + TAIL
                    await asyncio.sleep(0)

        except asyncio.CancelledError:
            # Cliente desconectou — encerra limpo
            break
        except Exception as e:
            print(f"[MJPEG] Erro {camera_id}: {e}", flush=True)
        finally:
            if proc:
                try:
                    proc.kill()
                    await proc.wait()
                except Exception:
                    pass

        # RTSP caiu: empurra frame de sem sinal por 3s antes de reconectar
        no_signal = _make_no_signal_frame(camera_id)
        deadline = time.time() + 3.0
        while time.time() < deadline:
            yield BOUNDARY + no_signal + TAIL
            await asyncio.sleep(0.5)


# -- SNAPSHOT e LIVE legados --

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
        except Exception:
            pass
    live_path = f"/tmp/live_{camera_id}.jpg"
    if os.path.exists(live_path):
        return Response(content=open(live_path, "rb").read(), media_type="image/jpeg",
                       headers={"Cache-Control": "no-cache"})
    raise HTTPException(status_code=503, detail="Frame nao disponivel ainda")


import glob

@router.get("/{camera_id}/hls/index.m3u8")
def hls_playlist(camera_id: str):
    """Serve o playlist HLS gerado pelo worker."""
    path = f"/tmp/hls/{camera_id}/index.m3u8"
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="HLS nao iniciado")
    content = open(path).read()
    return Response(
        content=content,
        media_type="application/vnd.apple.mpegurl",
        headers={
            "Cache-Control": "no-cache, no-store",
            "Access-Control-Allow-Origin": "*",
        }
    )

@router.get("/{camera_id}/hls/{segment}")
def hls_segment(camera_id: str, segment: str):
    """Serve segmentos .ts do HLS."""
    if not segment.endswith(".ts"):
        raise HTTPException(status_code=400, detail="Segmento invalido")
    path = f"/tmp/hls/{camera_id}/{segment}"
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Segmento nao encontrado")
    return Response(
        content=open(path, "rb").read(),
        media_type="video/mp2t",
        headers={
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
        }
    )

@router.get("/{camera_id}/snapshot")
def snapshot(camera_id: UUID, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera nao encontrada")
    if camera.http_url:
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
            r2 = urllib.request.urlopen(req2, timeout=5)
            data = r2.read()
            if len(data) > 1000:
                return Response(content=data, media_type="image/jpeg",
                               headers={"Cache-Control": "no-cache"})
        except Exception:
            pass
    raise HTTPException(status_code=503, detail="Snapshot nao disponivel")

