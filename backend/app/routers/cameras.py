from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from uuid import UUID
import uuid
import subprocess
import os
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

class RemoverCamera(BaseModel):
    camera_id: UUID

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
        raise HTTPException(status_code=404, detail="Camera nao encontrada")
    return camera

@router.delete("/{camera_id}")
def deletar_camera(camera_id: UUID, db: Session = Depends(get_db)):
    return _fazer_delete(camera_id, db)

@router.post("/remover")
def remover_camera(body: RemoverCamera, db: Session = Depends(get_db)):
    return _fazer_delete(body.camera_id, db)

def _fazer_delete(camera_id: UUID, db: Session):
    cid = str(camera_id)
    try:
        if cid in processos_ffmpeg:
            processos_ffmpeg[cid].kill()
            del processos_ffmpeg[cid]
    except:
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

@router.get("/{camera_id}/snapshot")
def snapshot(camera_id: UUID, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera nao encontrada")
    try:
        resultado = subprocess.run([
            "ffmpeg", "-y", "-rtsp_transport", "tcp",
            "-i", camera.rtsp_url,
            "-frames:v", "1", "-q:v", "5",
            "-f", "image2", "-vcodec", "mjpeg", "pipe:1"
        ], timeout=10, capture_output=True)
        if resultado.returncode == 0 and len(resultado.stdout) > 1000:
            return Response(content=resultado.stdout, media_type="image/jpeg",
                          headers={"Cache-Control": "no-cache"})
        raise HTTPException(status_code=502, detail="Camera nao respondeu")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Timeout")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def parar_stream(camera_id: str):
    if camera_id in processos_ffmpeg:
        try:
            processos_ffmpeg[camera_id].kill()
        except:
            pass
        del processos_ffmpeg[camera_id]

@router.post("/{camera_id}/stream/parar")
def parar_stream_endpoint(camera_id: UUID):
    parar_stream(str(camera_id))
    return {"status": "parado"}

@router.get("/streams/status")
def status_streams():
    return {cid: processos_ffmpeg[cid].poll() is None for cid in processos_ffmpeg}
