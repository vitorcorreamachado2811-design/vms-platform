$code = @'
import requests
import threading
import time
import numpy as np
from ultralytics import YOLO
from urllib.request import urlopen

API_BASE = "https://vms-platform-production.up.railway.app"
model = YOLO("yolov8n.pt")

def capturar_frame_rtsp(rtsp_url):
    import subprocess
    cmd = [
        "ffmpeg", "-rtsp_transport", "tcp",
        "-i", rtsp_url,
        "-frames:v", "1",
        "-f", "image2pipe",
        "-vcodec", "rawvideo",
        "-pix_fmt", "rgb24",
        "pipe:1"
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=10)
        if result.returncode == 0 and len(result.stdout) > 0:
            return result.stdout
    except Exception as e:
        print(f"Erro ffmpeg: {e}")
    return None

def processar_camera(camera):
    camera_id = camera["id"]
    nome = camera["nome"]
    rtsp_url = camera["rtsp_url"]

    print(f"[{nome}] Iniciando processamento...")

    while True:
        try:
            frame_data = capturar_frame_rtsp(rtsp_url)
            if frame_data is None:
                print(f"[{nome}] Sem frame. Tentando em 10s...")
                time.sleep(10)
                continue

            results = model(np.frombuffer(frame_data, dtype=np.uint8).reshape(-1, 1, 3), verbose=False)
            detections = results[0].boxes

            pessoas = 0
            for box in detections:
                class_id = int(box.cls[0])
                confianca = float(box.conf[0])
                if class_id == 0:
                    pessoas += 1
                    try:
                        requests.post(f"{API_BASE}/eventos/", json={
                            "camera_id": camera_id,
                            "tipo": "person",
                            "confianca": round(confianca, 2)
                        }, timeout=3)
                        print(f"[{nome}] Pessoa detectada ({confianca:.0%})")
                    except Exception as e:
                        print(f"[{nome}] Erro ao salvar: {e}")

            time.sleep(2)

        except Exception as e:
            print(f"[{nome}] Erro: {e}. Reiniciando em 10s...")
            time.sleep(10)

def main():
    print("VMS Worker iniciando...")

    while True:
        try:
            resp = requests.get(f"{API_BASE}/cameras/", timeout=10)
            cameras = resp.json()
            cameras_ativas = [c for c in cameras if c.get("ativo")]
            print(f"{len(cameras_ativas)} cameras ativas encontradas")
            break
        except Exception as e:
            print(f"Erro ao buscar cameras: {e}. Tentando em 5s...")
            time.sleep(5)

    threads = []
    for camera in cameras_ativas:
        t = threading.Thread(target=processar_camera, args=(camera,), daemon=True)
        t.start()
        threads.append(t)
        print(f"Thread iniciada: {camera['nome']}")

    print("Todas as threads rodando.")
    try:
        while True:
            time.sleep(60)
            vivas = sum(1 for t in threads if t.is_alive())
            print(f"Status: {vivas}/{len(threads)} cameras ativas")
    except KeyboardInterrupt:
        print("Worker encerrado.")

if __name__ == "__main__":
    main()
'@
Set-Content -Path "C:\Users\vitor\vms-platform\worker.py" -Value $code -Encoding UTF8