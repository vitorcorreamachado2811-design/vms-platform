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

# Keypoints YOLOv8 Pose
OMBRO_ESQ     = 5
OMBRO_DIR     = 6
QUADRIL_ESQ   = 11
QUADRIL_DIR   = 12
TORNOZELO_ESQ = 15
TORNOZELO_DIR = 16
PULSO_ESQ     = 9
PULSO_DIR     = 10

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

def pessoa_horizontal(box, keypoints):
    """Detecta se a pessoa está deitada/caída."""
    x1, y1, x2, y2 = box
    largura = x2 - x1
    altura  = y2 - y1
    if altura == 0 or largura == 0:
        return False
    # Critério 1: bounding box horizontal
    if (altura / largura) < 0.8:
        return True
    # Critério 2: ombros na mesma altura dos tornozelos
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

def pessoa_na_regiao(cx, cy, regiao):
    """Verifica se o centro da pessoa está dentro de uma região."""
    return (regiao["x1"] <= cx <= regiao["x2"] and
            regiao["y1"] <= cy <= regiao["y2"])

def lado_da_linha(px, py, x1, y1, x2, y2):
    return (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)

def salvar_evento(camera_id, tipo, confianca, nome):
    try:
        requests.post(f"{API_BASE}/eventos/", json={
            "camera_id": camera_id,
            "tipo": tipo,
            "confianca": round(confianca, 2)
        }, timeout=3)
        print(f"[{nome}] ⚠️ {tipo} ({confianca:.0%})", flush=True)
    except Exception as e:
        print(f"[{nome}] Erro evento: {e}", flush=True)

def enviar_heatmap(camera_id, acumulador, nome):
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
        print(f"[{nome}] Heatmap: {len(pontos)} pontos enviados", flush=True)
    except Exception as e:
        print(f"[{nome}] Erro heatmap: {e}", flush=True)

def buscar_configuracoes(camera_id):
    """Busca linha de contagem e regiões monitoradas."""
    linha = None
    regioes = []
    try:
        r = requests.get(f"{API_BASE}/contagem/{camera_id}", timeout=5)
        if r.status_code == 200:
            linha = r.json()
    except:
        pass
    try:
        r = requests.get(f"{API_BASE}/regioes/{camera_id}", timeout=5)
        if r.status_code == 200:
            regioes = r.json()
    except:
        pass
    return linha, regioes

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

    print(f"[{nome}] Iniciando monitoramento de idosos...", flush=True)

    tracks = {}
    next_id = 0
    linha = None
    regioes = []
    config_refresh = 0
    heatmap_acc = defaultdict(float)
    heatmap_ultimo_envio = time.time()

    # Cooldown por tipo de alerta — evita spam de eventos
    # {track_id: {tipo: ultimo_timestamp}}
    cooldowns = defaultdict(lambda: defaultdict(float))
    COOLDOWN_SEGUNDOS = 30

    while True:
        try:
            agora = time.time()

            # Atualiza configurações a cada 30s
            if agora - config_refresh > 30:
                linha, regioes = buscar_configuracoes(camera_id)
                config_refresh = agora
                cama = next((r for r in regioes if r["tipo"] == "cama"), None)
                if cama:
                    print(f"[{nome}] Região da cama carregada", flush=True)

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

            # Região da cama atual
            cama = next((r for r in regioes if r["tipo"] == "cama"), None)

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

                    # Acumula heatmap
                    hx = round(cx / 0.02) * 0.02
                    hy = round(cy / 0.02) * 0.02
                    heatmap_acc[(hx, hy)] += 1

                    horizontal = pessoa_horizontal(det["box"], det["kps"])
                    na_cama = cama and pessoa_na_regiao(cx, cy, cama)
                    estava_na_cama = track.get("na_cama", False)

                    def pode_alertar(tipo):
                        ultimo = cooldowns[tid][tipo]
                        return agora - ultimo > COOLDOWN_SEGUNDOS

                    # Detecta queda do leito
                    # Estava na cama, agora está fora E horizontal
                    if estava_na_cama and not na_cama and horizontal:
                        if pode_alertar("queda_leito"):
                            salvar_evento(camera_id, "queda_leito", det["conf"], nome)
                            cooldowns[tid]["queda_leito"] = agora

                    # Detecta queda em pé
                    # Não estava na cama, está horizontal
                    elif not na_cama and horizontal and not estava_na_cama:
                        if pode_alertar("queda_pe"):
                            salvar_evento(camera_id, "queda_pe", det["conf"], nome)
                            cooldowns[tid]["queda_pe"] = agora

                    # Linha de contagem
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
                        "lado": lado_da_linha(cx, cy,
                            linha["x1"], linha["y1"],
                            linha["x2"], linha["y2"]) if linha else None,
                        "na_cama": na_cama,
                        "horizontal": horizontal,
                    }

                    # Pessoa normal — sem queda
                    if not horizontal and not na_cama:
                        if pode_alertar("person"):
                            salvar_evento(camera_id, "person", det["conf"], nome)
                            cooldowns[tid]["person"] = agora

            # Novos tracks
            for idx, det in enumerate(deteccoes):
                if idx not in usados:
                    cx = (det["box"][0] + det["box"][2]) / 2 / w
                    cy = (det["box"][1] + det["box"][3]) / 2 / h
                    hx = round(cx / 0.02) * 0.02
                    hy = round(cy / 0.02) * 0.02
                    heatmap_acc[(hx, hy)] += 1
                    na_cama = cama and pessoa_na_regiao(cx, cy, cama)
                    lado_ini = None
                    if linha:
                        lado_ini = lado_da_linha(cx, cy,
                            linha["x1"], linha["y1"],
                            linha["x2"], linha["y2"])
                    novos_tracks[next_id] = {
                        "box": det["box"],
                        "lado": lado_ini,
                        "na_cama": na_cama,
                        "horizontal": pessoa_horizontal(det["box"], det["kps"]),
                    }
                    next_id += 1

            tracks = novos_tracks
            time.sleep(2)

        except Exception as e:
            print(f"[{nome}] Erro: {e}. Reiniciando em 10s...", flush=True)
            time.sleep(10)

def main():
    print("VMS Worker — Monitoramento de Idosos iniciando...", flush=True)
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