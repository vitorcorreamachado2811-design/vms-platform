import requests
import threading
import time
import numpy as np
from collections import defaultdict
from ultralytics import YOLO

API_BASE = "https://vms-platform-production.up.railway.app"

print("Carregando modelo YOLOv8 Pose...", flush=True)
model_pose = YOLO("yolov8n-pose.pt")
print("Modelo carregado!", flush=True)

OMBRO_ESQ     = 5
OMBRO_DIR     = 6
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
        print(f"Erro ffmpeg: {e}", flush=True)
    return None

def detectar_queda(box, keypoints):
    x1, y1, x2, y2 = box
    largura = x2 - x1
    altura  = y2 - y1
    if altura == 0 or largura == 0:
        return False
    if (altura / largura) < 0.8:
        return True
    if keypoints is not None and len(keypoints) >= 17:
        kp = keypoints
        ombro_y = None
        tornozelo_y = None
        if kp[OMBRO_ESQ][2] > 0.3 and kp[OMBRO_DIR][2] > 0.3:
            ombro_y = (kp[OMBRO_ESQ][1] + kp[OMBRO_DIR][1]) / 2
        if kp[TORNOZELO_ESQ][2] > 0.3 and kp[TORNOZELO_DIR][2] > 0.3:
            tornozelo_y = (kp[TORNOZELO_ESQ][1] + kp[TORNOZELO_DIR][1]) / 2
        if ombro_y is not None and tornozelo_y is not None:
            if abs(tornozelo_y - ombro_y) < altura * 0.3:
                return True
    return False

def lado_da_linha(px, py, x1, y1, x2, y2):
    return (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)

def salvar_evento(camera_id, tipo, confianca, nome):
    try:
        requests.post(f"{API_BASE}/eventos/", json={
            "camera_id": camera_id,
            "tipo": tipo,
            "confianca": round(confianca, 2)
        }, timeout=3)
        print(f"[{nome}] {tipo} ({confianca:.0%})", flush=True)
    except Exception as e:
        print(f"[{nome}] Erro evento: {e}", flush=True)

def enviar_heatmap(camera_id, acumulador, nome):
    """Envia batch de pontos do heatmap para o backend."""
    if not acumulador:
        return
    pontos = [
        {"x": round(x, 3), "y": round(y, 3), "peso": float(p)}
        for (x, y), p in acumulador.items()
    ]
    try:
        requests.post(f"{API_BASE}/heatmap/batch", json={
            "camera_id": camera_id,
            "pontos": pontos
        }, timeout=5)
        print(f"[{nome}] Heatmap enviado: {len(pontos)} pontos", flush=True)
    except Exception as e:
        print(f"[{nome}] Erro heatmap: {e}", flush=True)

def buscar_linha(camera_id):
    try:
        r = requests.get(f"{API_BASE}/contagem/{camera_id}", timeout=5)
        if r.status_code == 200:
            return r.json()
    except:
        pass
    return None

def iou(boxA, boxB):
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])
    inter = max(0, xB - xA) * max(0, yB - yA)
    if inter == 0:
        return 0
    areaA = (boxA[2]-boxA[0]) * (boxA[3]-boxA[1])
    areaB = (boxB[2]-boxB[0]) * (boxB[3]-boxB[1])
    return inter / (areaA + areaB - inter)

def processar_camera(camera):
    camera_id = camera["id"]
    nome      = camera["nome"]
    rtsp_url  = camera["rtsp_url"]

    print(f"[{nome}] Iniciando com pose + quedas + heatmap...", flush=True)

    tracks = {}
    next_id = 0
    linha = None
    linha_refresh = 0

    # Acumulador do heatmap: {(x, y): peso}
    heatmap_acc = defaultdict(float)
    heatmap_ultimo_envio = time.time()

    while True:
        try:
            agora = time.time()

            # Atualiza linha a cada 30s
            if agora - linha_refresh > 30:
                linha = buscar_linha(camera_id)
                linha_refresh = agora

            # Envia heatmap a cada 60s
            if agora - heatmap_ultimo_envio > 60:
                enviar_heatmap(camera_id, dict(heatmap_acc), nome)
                heatmap_acc.clear()
                heatmap_ultimo_envio = agora

            frame_data = capturar_frame(rtsp_url)
            if frame_data is None:
                print(f"[{nome}] Sem frame. Aguardando 10s...", flush=True)
                time.sleep(10)
                continue

            import cv2
            arr = np.frombuffer(frame_data, dtype=np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame is None:
                time.sleep(5)
                continue

            h, w = frame.shape[:2]
            results = model_pose(frame, verbose=False)

            deteccoes = []
            for result in results:
                for i, box in enumerate(result.boxes):
                    if int(box.cls[0]) != 0:
                        continue
                    conf = float(box.conf[0])
                    if conf < 0.4:
                        continue
                    coords = box.xyxy[0].cpu().numpy()
                    kps = None
                    if result.keypoints is not None and i < len(result.keypoints.data):
                        kps = result.keypoints.data[i].cpu().numpy()
                    deteccoes.append({"box": coords, "conf": conf, "kps": kps})

            # Associa tracks via IoU
            novos_tracks = {}
            usados = set()

            for tid, track in tracks.items():
                melhor_iou = 0.3
                melhor_idx = -1
                for idx, det in enumerate(deteccoes):
                    if idx in usados:
                        continue
                    score = iou(track["box"], det["box"])
                    if score > melhor_iou:
                        melhor_iou = score
                        melhor_idx = idx

                if melhor_idx >= 0:
                    det = deteccoes[melhor_idx]
                    usados.add(melhor_idx)

                    cx = (det["box"][0] + det["box"][2]) / 2 / w
                    cy = (det["box"][1] + det["box"][3]) / 2 / h

                    # Acumula no heatmap (célula de 2%)
                    hx = round(cx / 0.02) * 0.02
                    hy = round(cy / 0.02) * 0.02
                    heatmap_acc[(hx, hy)] += 1

                    # Verifica queda
                    if detectar_queda(det["box"], det["kps"]):
                        salvar_evento(camera_id, "queda", det["conf"], nome)

                    # Verifica cruzamento de linha
                    if linha:
                        lado_atual = lado_da_linha(cx, cy,
                            linha["x1"], linha["y1"],
                            linha["x2"], linha["y2"])
                        lado_ant = track.get("lado")
                        if lado_ant is not None and lado_atual != 0:
                            if lado_ant > 0 and lado_atual < 0:
                                salvar_evento(camera_id, "entrada", det["conf"], nome)
                            elif lado_ant < 0 and lado_atual > 0:
                                salvar_evento(camera_id, "saida", det["conf"], nome)
                        novos_tracks[tid] = {
                            "box": det["box"],
                            "lado": lado_atual if lado_atual != 0 else track.get("lado")
                        }
                    else:
                        salvar_evento(camera_id, "person", det["conf"], nome)
                        novos_tracks[tid] = {"box": det["box"], "lado": None}

            # Novos tracks
            for idx, det in enumerate(deteccoes):
                if idx not in usados:
                    cx = (det["box"][0] + det["box"][2]) / 2 / w
                    cy = (det["box"][1] + det["box"][3]) / 2 / h
                    hx = round(cx / 0.02) * 0.02
                    hy = round(cy / 0.02) * 0.02
                    heatmap_acc[(hx, hy)] += 1
                    lado_ini = None
                    if linha:
                        lado_ini = lado_da_linha(cx, cy,
                            linha["x1"], linha["y1"],
                            linha["x2"], linha["y2"])
                    novos_tracks[next_id] = {"box": det["box"], "lado": lado_ini}
                    next_id += 1

            tracks = novos_tracks
            time.sleep(2)

        except Exception as e:
            print(f"[{nome}] Erro: {e}. Reiniciando em 10s...", flush=True)
            time.sleep(10)

def main():
    print("VMS Worker iniciando com YOLOv8 Pose + Quedas + Heatmap...", flush=True)
    while True:
        try:
            resp    = requests.get(f"{API_BASE}/cameras/", timeout=10)
            cameras = [c for c in resp.json() if c.get("ativo")]
            print(f"{len(cameras)} cameras ativas", flush=True)
            break
        except Exception as e:
            print(f"Erro: {e}. Tentando em 5s...", flush=True)
            time.sleep(5)

    threads = []
    for camera in cameras:
        t = threading.Thread(target=processar_camera, args=(camera,), daemon=True)
        t.start()
        threads.append(t)
        print(f"Thread iniciada: {camera['nome']}", flush=True)

    try:
        while True:
            time.sleep(60)
            vivas = sum(1 for t in threads if t.is_alive())
            print(f"Status: {vivas}/{len(threads)} cameras ativas", flush=True)
    except KeyboardInterrupt:
        print("Worker encerrado.")

if __name__ == "__main__":
    main()