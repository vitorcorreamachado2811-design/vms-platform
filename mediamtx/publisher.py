#!/usr/bin/env python3
"""
VMS Platform - Publicador RTSP para MediaMTX
Cada camera RTSP e republicada no MediaMTX via ffmpeg.
O MediaMTX entao distribui via WebRTC para os browsers.

Fluxo:
  Camera RTSP → ffmpeg → MediaMTX RTSP → WebRTC → Browser

Vantagens:
  - Browser recebe WebRTC nativo (<500ms latencia)
  - IA processa em paralelo sem afetar o stream
  - ffmpeg faz transcoding eficiente com H.264
"""

import subprocess
import threading
import time
import requests
import os

API_BASE     = "https://vms-platform-production.up.railway.app"
MEDIAMTX_URL = os.environ.get("MEDIAMTX_URL", "http://localhost:9997")

# URL base do MediaMTX para publicacao RTSP
# O worker publica em: rtsp://mediamtx:8554/{camera_id}
MEDIAMTX_RTSP = os.environ.get("MEDIAMTX_RTSP_URL", "rtsp://localhost:8554")

_processos: dict = {}
_status: dict    = {}


def publicar_camera(camera_id: str, rtsp_url: str, nome: str):
    """
    Publica a camera no MediaMTX via ffmpeg.
    ffmpeg le o RTSP da camera e republica no MediaMTX.
    """
    destino = f"{MEDIAMTX_RTSP}/{camera_id}"

    print(f"[PUBLISHER] Iniciando {nome} -> {destino}", flush=True)

    while _status.get(camera_id, {}).get("rodando"):
        proc = None
        try:
            cmd = [
                "ffmpeg",
                "-loglevel", "error",
                "-rtsp_transport", "tcp",
                "-i", rtsp_url,
                # Copia o video sem recodificar se possivel (mais rapido)
                "-c:v", "copy",
                # Remove audio para economizar banda
                "-an",
                # Publica no MediaMTX via RTSP
                "-f", "rtsp",
                "-rtsp_transport", "tcp",
                destino
            ]

            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE
            )

            _processos[camera_id] = proc
            print(f"[PUBLISHER] {nome} publicando em {destino}", flush=True)

            # Monitora o processo
            while _status.get(camera_id, {}).get("rodando"):
                ret = proc.poll()
                if ret is not None:
                    err = proc.stderr.read().decode('utf-8', errors='ignore')
                    print(f"[PUBLISHER] {nome} encerrou (cod {ret}): {err[:200]}", flush=True)
                    break
                time.sleep(1)

        except Exception as e:
            print(f"[PUBLISHER] Erro {nome}: {e}", flush=True)
        finally:
            if proc:
                try: proc.kill()
                except: pass

        if _status.get(camera_id, {}).get("rodando"):
            print(f"[PUBLISHER] {nome} reconectando em 3s...", flush=True)
            time.sleep(3)

    print(f"[PUBLISHER] {nome} encerrado", flush=True)


def iniciar_publisher(camera_id: str, rtsp_url: str, nome: str):
    if _status.get(camera_id, {}).get("rodando"):
        return
    _status[camera_id] = {"rodando": True}
    t = threading.Thread(
        target=publicar_camera,
        args=(camera_id, rtsp_url, nome),
        daemon=True
    )
    t.start()


def parar_publisher(camera_id: str):
    if camera_id in _status:
        _status[camera_id]["rodando"] = False
    if camera_id in _processos:
        try: _processos[camera_id].kill()
        except: pass


def main():
    print("VMS Publisher iniciando...", flush=True)
    print(f"MediaMTX RTSP: {MEDIAMTX_RTSP}", flush=True)

    # Busca cameras
    while True:
        try:
            resp    = requests.get(f"{API_BASE}/cameras/", timeout=10)
            cameras = [c for c in resp.json() if c.get("ativo")]
            print(f"{len(cameras)} cameras ativas", flush=True)
            break
        except Exception as e:
            print(f"Erro ao buscar cameras: {e}. Tentando em 5s...", flush=True)
            time.sleep(5)

    # Inicia publisher para cada camera
    for camera in cameras:
        iniciar_publisher(camera["id"], camera["rtsp_url"], camera["nome"])
        time.sleep(0.5)  # Evita abrir tudo ao mesmo tempo

    # Loop de monitoramento
    try:
        while True:
            time.sleep(60)
            ativos = sum(1 for s in _status.values() if s.get("rodando"))
            print(f"[PUBLISHER] Status: {ativos}/{len(cameras)} cameras publicando", flush=True)
    except KeyboardInterrupt:
        print("Publisher encerrado.")


if __name__ == "__main__":
    main()
