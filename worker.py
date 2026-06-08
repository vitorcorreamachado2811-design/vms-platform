import cv2
import requests
import threading
import time
from ultralytics import YOLO

API_BASE = "https://vms-platform-production.up.railway.app"
model = YOLO("yolov8n.pt")

def processar_camera(camera):
    camera_id = camera["id"]
    nome = camera["nome"]
    rtsp_url = camera["rtsp_url"]

    print(f"[{nome}] Conectando ao stream RTSP...")

    while True:
        try:
            cap = cv2.VideoCapture(rtsp_url)
            if not cap.isOpened():
                print(f"[{nome}] Erro ao conectar. Tentando novamente em 10s...")
                time.sleep(10)
                continue

            print(f"[{nome}] Conectado!")
            frame_count = 0

            while True:
                ret, frame = cap.read()
                if not ret:
                    print(f"[{nome}] Stream perdido. Reconectando...")
                    break

                frame_count += 1
                if frame_count % 15 != 0:
                    continue

                results = model(frame, verbose=False)
                detections = results[0].boxes

                for box in detections:
                    class_id = int(box.cls[0])
                    confianca = float(box.conf[0])

                    if class_id == 0:
                        try:
                            requests.post(f"{API_BASE}/eventos/", json={
                                "camera_id": camera_id,
                                "tipo": "person",
                                "confianca": round(confianca, 2)
                            }, timeout=3)
                            print(f"[{nome}] Pessoa detectada ({confianca:.0%}) — salvo!")
                        except Exception as e:
                            print(f"[{nome}] Erro ao salvar: {e}")

            cap.release()

        except Exception as e:
            print(f"[{nome}] Erro: {e}. Reiniciando em 10s...")
            time.sleep(10)

def main():
    print("VMS Worker iniciando...")
    print(f"Conectando ao backend: {API_BASE}")

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
        t = threading.Thread(
            target=processar_camera,
            args=(camera,),
            daemon=True
        )
        t.start()
        threads.append(t)
        print(f"Thread iniciada para: {camera['nome']}")

    print("Todas as threads rodando. Pressione Ctrl+C para parar.")
    try:
        while True:
            time.sleep(60)
            vivas = sum(1 for t in threads if t.is_alive())
            print(f"Status: {vivas}/{len(threads)} cameras ativas")
    except KeyboardInterrupt:
        print("Worker encerrado.")

if __name__ == "__main__":
    main()
