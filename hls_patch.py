# Script para adicionar HLS ao worker.py
# Roda: python3 hls_patch.py

import re

with open('worker.py', 'r', encoding='utf-8', errors='replace') as f:
    src = f.read()

# 1. Adiciona dicts e funcoes HLS apos PUBLISH_INTERVALO
hls_code = '''
# ── HLS STREAMING ──────────────────────────────────────────────────────────────
_hls_processos: dict = {}

def iniciar_hls(camera_id: str, rtsp_url: str):
    if camera_id in _hls_processos:
        try: _hls_processos[camera_id].kill()
        except: pass
    hls_dir = f"/tmp/hls/{camera_id}"
    os.makedirs(hls_dir, exist_ok=True)
    cmd = [
        "ffmpeg", "-y",
        "-rtsp_transport", "tcp",
        "-i", rtsp_url,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-b:v", "600k",
        "-s", "640x360",
        "-g", "15",
        "-hls_time", "1",
        "-hls_list_size", "3",
        "-hls_flags", "delete_segments+omit_endlist",
        "-hls_segment_filename", f"{hls_dir}/seg%03d.ts",
        f"{hls_dir}/index.m3u8"
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    _hls_processos[camera_id] = proc
    print(f"[HLS] Iniciado para {camera_id}", flush=True)

def parar_hls(camera_id: str):
    if camera_id in _hls_processos:
        try: _hls_processos[camera_id].kill()
        except: pass
        del _hls_processos[camera_id]

'''

# Insere apos a linha PUBLISH_INTERVALO
src = src.replace(
    'PUBLISH_INTERVALO = 0.1      # 10fps = a cada 100ms',
    'PUBLISH_INTERVALO = 0.1      # 10fps = a cada 100ms\n' + hls_code
)

# 2. Chama iniciar_hls quando inicia captura continua
src = src.replace(
    'def iniciar_captura_continua(camera_id: str, rtsp_url: str):\n    if _captura_status.get(camera_id, {}).get("rodando"):\n        return\n    _captura_status[camera_id] = {"rodando": True}',
    'def iniciar_captura_continua(camera_id: str, rtsp_url: str):\n    if _captura_status.get(camera_id, {}).get("rodando"):\n        return\n    _captura_status[camera_id] = {"rodando": True}\n    # Inicia HLS em paralelo\n    threading.Thread(target=iniciar_hls, args=(camera_id, rtsp_url), daemon=True).start()'
)

with open('worker.py', 'w', encoding='utf-8') as f:
    f.write(src)

print("worker.py atualizado com HLS!")
