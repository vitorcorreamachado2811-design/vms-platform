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


@router.get("/ping")
def ping():
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
