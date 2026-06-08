from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
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

# Dicionário global que guarda os processos FFmpeg ativos
# Chave: camera_id (str), Valor: subprocess.Popen
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
        raise HTTPException(status_code=404, detail="Câmera não encontrada")
    return camera

@router.delete("/{camera_id}")
def deletar_camera(camera_id: UUID, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Câmera não encontrada")
    # Para o FFmpeg se estiver rodando
    parar_stream(str(camera_id))
    db.delete(camera)
    db.commit()
    return {"mensagem": "Câmera removida"}

# ── SNAPSHOT ──────────────────────────────────────────────────────────────────

@router.get("/{camera_id}/snapshot")
def snapshot(camera_id: UUID, db: Session = Depends(get_db)):
    """
    Captura um frame JPG da câmera via FFmpeg.
    Útil para thumbnail e verificação de conexão.
    """
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Câmera não encontrada")

    caminho = f"/tmp/snapshot_{camera_id}.jpg"

    try:
        # FFmpeg captura 1 frame e sai — timeout 10s
        resultado = subprocess.run([
            "ffmpeg", "-y",
            "-rtsp_transport", "tcp",          # TCP é mais estável que UDP
            "-i", camera.rtsp_url,
            "-frames:v", "1",                   # Só 1 frame
            "-q:v", "2",                        # Qualidade alta (1-31, menor = melhor)
            caminho
        ], timeout=10, capture_output=True)

        if not os.path.exists(caminho):
            raise HTTPException(status_code=502, detail="Câmera não respondeu")

        return FileResponse(
            caminho,
            media_type="image/jpeg",
            headers={"Cache-Control": "no-cache"}  # Sempre busca frame novo
        )

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Timeout ao conectar na câmera")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── HLS STREAM ────────────────────────────────────────────────────────────────

def iniciar_ffmpeg(camera_id: str, rtsp_url: str):
    """
    Inicia o FFmpeg em background convertendo RTSP → HLS.
    Cria segmentos de 2s em /tmp/hls_{camera_id}/
    """
    pasta = f"/tmp/hls_{camera_id}"
    os.makedirs(pasta, exist_ok=True)

    processo = subprocess.Popen([
        "ffmpeg", "-y",
        "-rtsp_transport", "tcp",
        "-i", rtsp_url,
        "-c:v", "libx264",          # Codec H264 — compatível com todos os browsers
        "-preset", "ultrafast",      # Prioriza velocidade sobre compressão
        "-tune", "zerolatency",      # Minimiza buffer interno do FFmpeg
        "-c:a", "aac",              # Áudio AAC
        "-f", "hls",                # Formato de saída HLS
        "-hls_time", "2",           # Cada segmento dura 2 segundos
        "-hls_list_size", "5",      # Mantém só os 5 últimos segmentos (10s de buffer)
        "-hls_flags", "delete_segments",  # Apaga segmentos antigos automaticamente
        f"{pasta}/stream.m3u8"      # Arquivo playlist HLS
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    processos_ffmpeg[camera_id] = processo
    return processo

def parar_stream(camera_id: str):
    """Para o processo FFmpeg de uma câmera específica."""
    if camera_id in processos_ffmpeg:
        processos_ffmpeg[camera_id].terminate()
        del processos_ffmpeg[camera_id]

@router.post("/{camera_id}/stream/iniciar")
def iniciar_stream(camera_id: UUID, db: Session = Depends(get_db)):
    """
    Inicia o processo FFmpeg para a câmera.
    Chame este endpoint antes de abrir o player HLS.
    """
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Câmera não encontrada")

    cid = str(camera_id)

    # Se já tem processo rodando, não inicia outro
    if cid in processos_ffmpeg and processos_ffmpeg[cid].poll() is None:
        return {"status": "já rodando", "playlist": f"/cameras/{cid}/stream/playlist"}

    iniciar_ffmpeg(cid, camera.rtsp_url)

    # Aguarda até 8s para o primeiro segmento aparecer
    pasta = f"/tmp/hls_{cid}"
    for _ in range(16):
        if os.path.exists(f"{pasta}/stream.m3u8"):
            break
        time.sleep(0.5)
    else:
        parar_stream(cid)
        raise HTTPException(status_code=502, detail="FFmpeg não conseguiu conectar na câmera")

    return {
        "status": "iniciado",
        "playlist": f"/cameras/{cid}/stream/playlist"
    }

@router.get("/{camera_id}/stream/playlist")
def servir_playlist(camera_id: UUID):
    """Serve o arquivo .m3u8 para o player HLS."""
    cid = str(camera_id)
    caminho = f"/tmp/hls_{cid}/stream.m3u8"

    if not os.path.exists(caminho):
        raise HTTPException(status_code=404, detail="Stream não iniciado")

    return FileResponse(
        caminho,
        media_type="application/vnd.apple.mpegurl",
        headers={"Cache-Control": "no-cache"}
    )

@router.get("/{camera_id}/stream/{segmento}")
def servir_segmento(camera_id: UUID, segmento: str):
    """Serve os segmentos .ts do stream HLS."""
    cid = str(camera_id)
    caminho = f"/tmp/hls_{cid}/{segmento}"

    if not os.path.exists(caminho):
        raise HTTPException(status_code=404, detail="Segmento não encontrado")

    return FileResponse(caminho, media_type="video/mp2t")

@router.post("/{camera_id}/stream/parar")
def parar_stream_endpoint(camera_id: UUID):
    """Para o processo FFmpeg da câmera."""
    parar_stream(str(camera_id))
    return {"status": "parado"}

@router.get("/streams/status")
def status_streams():
    """Retorna quais câmeras estão com stream ativo."""
    return {
        cid: processos_ffmpeg[cid].poll() is None
        for cid in processos_ffmpeg
    }