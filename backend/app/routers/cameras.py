from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session
from sqlalchemy import text
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

@router.get("/ping")
def ping():
    return {"ok": True}

@router.get("/", response_model=list[CameraResponse])
def listar_cameras(db: Session = Depends(get_db)):
    return db.query(Camera).all()

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
def live_frame(camera_id: UUID):
    """Serve o frame mais recente capturado pelo worker (sem abrir RTSP)."""
    live_path = f"/tmp/live_{camera_id}.jpg"
    if os.path.exists(live_path):
        return Response(
            content=open(live_path, "rb").read(),
            media_type="image/jpeg",
            headers={"Cache-Control": "no-cache", "X-From-Worker": "true"}
        )
    raise HTTPException(status_code=503, detail="Frame nao disponivel ainda")

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

