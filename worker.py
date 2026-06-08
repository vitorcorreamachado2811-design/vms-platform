import requests
import threading
import time
import numpy as np
from ultralytics import YOLO

API_BASE = "https://vms-platform-production.up.railway.app"

# Modelo pose para detecção de pessoas E análise de quedas
model_pose = YOLO("yolov8n-pose.pt")

# Índices dos keypoints YOLOv8 Pose
NOSE        = 0
OMBRO_ESQ   = 5
OMBRO_DIR   = 6
QUADRIL_ESQ = 11
QUADRIL_DIR = 12
TORNOZELO_ESQ = 15
TORNOZELO_DIR = 16

def capturar_frame(rtsp_url):
    import subprocess
    cmd = [
        "ffmpeg", "-rtsp_transport", "tcp",
        "-i", rtsp_url,
        "-frames:v", "1",
        "-f", "image2",
        "-vcodec", "mjpeg",
        "pipe:1"
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=15)
        if result.returncode == 0 and len(result.stdout) > 0:
            return result.stdout
    except Exception as e:
        print(f"Erro ffmpeg: {e}")
    return None

def detectar_queda(box, keypoints):
    """
    Detecta queda baseado em 2 critérios:
    1. Aspect ratio do bounding box (pessoa deitada = mais larga que alta)
    2. Posição relativa dos keypoints (ombros próximos dos tornozelos em Y)
    Retorna True se detectar queda.
    """
    # Critério 1: bounding box
    x1, y1, x2, y2 = box
    largura = x2 - x1
    altura  = y2 - y1
    if altura == 0:
        return False
    ratio = altura / largura  # < 1 = mais largo que alto = deitado

    if ratio < 0.8:
        return True  # Pessoa claramente horizontal

    # Critério 2: keypoints — ombros na mesma altura dos tornozelos
    if keypoints is not None and len(keypoints) >= 17:
        kp = keypoints

        # Pega Y dos ombros e tornozelos (se confiança > 0.3)
        ombro_y = None
        tornozelo_y = None

        if kp[OMBRO_ESQ][2] > 0.3 and kp[OMBRO_DIR][2] > 0.3:
            ombro_y = (kp[OMBRO_ESQ][1] + kp[OMBRO_DIR][1]) / 2

        if kp[TORNOZELO_ESQ][2] > 0.3 and kp[TORNOZELO_DIR][2] > 0.3:
            tornozelo_y = (kp[TORNOZELO_ESQ][1] + kp[TORNOZELO_DIR][1]) / 2

        if ombro_y is not None and tornozelo_y is not None:
            # Se ombros e tornozelos estão quase na mesma altura Y → deitado
            diferenca_y = abs(tornozelo_y - ombro_y)
            if diferenca_y < altura * 0.3:
                return True

    return False

def salvar_evento(camera_id, tipo, confianca, nome):
    try:
        requests.post(f"{API_BASE}/eventos/", json={
            "camera_id": camera_id,
            "tipo": tipo,
            "confianca": round(confianca, 2)
        }, timeout=3)
        print(f"[{nome}] {tipo} detectado ({confianca:.0%})")
    except Exception as e:
        print(f"[{nome}] Erro ao salvar evento: {e}")

def processar_camera(camera):
    camera_id = camera["id"]
    nome      = camera["nome"]
    rtsp_url  = camera["rtsp_url"]

    print(f"[{nome}] Iniciando com detecção de pose + quedas...")

    while True:
        try:
            frame_data = capturar_frame(rtsp_url)
            if frame_data is None:
                print(f"[{nome}] Sem frame. Aguardando 10s...")
                time.sleep(10)
                continue

            # Converte bytes JPEG → numpy para o YOLO
            import cv2
            arr = np.frombuffer(frame_data, dtype=np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame is None:
                time.sleep(5)
                continue

            results = model_pose(frame, verbose=False)

            for result in results:
                boxes     = result.boxes
                keypoints = result.keypoints

                for i, box in enumerate(boxes):
                    class_id  = int(box.cls[0])
                    confianca = float(box.conf[0])

                    # Só processa pessoas (class 0)
                    if class_id != 0 or confianca < 0.4:
                        continue

                    # Pega keypoints desta pessoa
                    kps = None
                    if keypoints is not None and i < len(keypoints.data):
                        kps = keypoints.data[i].cpu().numpy()

                    # Coordenadas do bounding box
                    coords = box.xyxy[0].cpu().numpy()

                    # Verifica queda
                    if detectar_queda(coords, kps):
                        salvar_evento(camera_id, "queda", confianca, nome)
                    else:
                        salvar_evento(camera_id, "person", confianca, nome)

            time.sleep(2)

        except Exception as e:
            print(f"[{nome}] Erro: {e}. Reiniciando em 10s...")
            time.sleep(10)

def main():
    print("VMS Worker iniciando com YOLOv8 Pose + Detecção de Quedas...")

    while True:
        try:
            resp    = requests.get(f"{API_BASE}/cameras/", timeout=10)
            cameras = [c for c in resp.json() if c.get("ativo")]
            print(f"{len(cameras)} cameras ativas")
            break
        except Exception as e:
            print(f"Erro: {e}. Tentando em 5s...")
            time.sleep(5)

    threads = []
    for camera in cameras:
        t = threading.Thread(
            target=processar_camera,
            args=(camera,),
            daemon=True
        )
        t.start()
        threads.append(t)
        print(f"Thread iniciada: {camera['nome']}")

    try:
        while True:
            time.sleep(60)
            vivas = sum(1 for t in threads if t.is_alive())
            print(f"Status: {vivas}/{len(threads)} cameras ativas")
    except KeyboardInterrupt:
        print("Worker encerrado.")

if __name__ == "__main__":
    main()