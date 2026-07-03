import requests
import threading
import time
import numpy as np
import math
import os
import cv2
import tempfile
import collections
import subprocess
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from ultralytics import YOLO
from supabase import create_client

API_BASE = "https://vms-platform-production.up.railway.app"

EMPRESA_ID = os.environ.get('EMPRESA_ID', '')  # Se vazio, processa todas
SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

print("Carregando modelo YOLOv8 Pose...", flush=True)
model_pose = YOLO("yolov8n-pose.pt")
print("Modelo Pose carregado!", flush=True)

print("Carregando modelo YOLOv8 Objetos (copos/potes)...", flush=True)
model_objetos = YOLO("yolov8n.pt")
print("Modelo Objetos carregado!", flush=True)

OMBRO_ESQ     = 5
OMBRO_DIR     = 6
QUADRIL_ESQ   = 11
QUADRIL_DIR   = 12
TORNOZELO_ESQ = 15
TORNOZELO_DIR = 16
PULSO_ESQ     = 9
PULSO_DIR     = 10

MIN_AMOSTRAS          = 3
THRESHOLD_MULTIPLIER  = 1.5
TOLERANCIA_MINIMA_MIN = 15
BANHO_DURACAO_MIN     = 5
COZINHA_DURACAO_MIN   = 10

PRE_EVENTO_SEG = 10
POS_EVENTO_SEG = 10
FPS_BUFFER     = 5
MAX_BUFFER     = PRE_EVENTO_SEG * FPS_BUFFER

_buffers: dict = {}

PUBLISH_INTERVALO = 0.1
_ultimo_publish: dict = {}
_publish_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="publish")
_clipe_pool   = ThreadPoolExecutor(max_workers=4, thread_name_prefix="clipe")
_publish_em_andamento: dict = {}
_publish_lock = threading.Lock()


def publish_live_frame(camera_id: str, frame):
    with _publish_lock:
        _publish_em_andamento[camera_id] = False
    try:
        frame_pequeno = cv2.resize(frame, (640, 360))
        _, buffer = cv2.imencode('.jpg', frame_pequeno, [cv2.IMWRITE_JPEG_QUALITY, 60])
        jpg_bytes = buffer.tobytes()
        requests.post(
            f"{API_BASE}/cameras/{camera_id}/frame",
            data=jpg_bytes,
            headers={"Content-Type": "image/jpeg"},
            timeout=2
        )
    except Exception as e:
        print(f"[LIVE] Erro publish {camera_id}: {e}", flush=True)


def agendar_publish(camera_id: str, frame):
    agora = time.time()
    if agora - _ultimo_publish.get(camera_id, 0) < PUBLISH_INTERVALO:
        return
    with _publish_lock:
        if _publish_em_andamento.get(camera_id, False):
            return
        _publish_em_andamento[camera_id] = True
    _ultimo_publish[camera_id] = agora
    _publish_pool.submit(publish_live_frame, camera_id, frame.copy())


MEDIAMTX_RTSP = os.environ.get("MEDIAMTX_RTSP_URL", "rtsp://wonderful-laughter.railway.internal:8554")
MEDIAMTX_PUBLISH_SECRET = os.environ.get("MEDIAMTX_PUBLISH_SECRET", "")

def _destino_publish_rtmp(camera_id: str) -> str:
    hostname = MEDIAMTX_RTSP.replace("rtsp://", "").split(":")[0]
    return f"rtmp://{hostname}:1935/{camera_id}?user=publisher&pass={MEDIAMTX_PUBLISH_SECRET}"


def get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def get_buffer(camera_id: str) -> collections.deque:
    if camera_id not in _buffers:
        _buffers[camera_id] = collections.deque(maxlen=MAX_BUFFER)
    return _buffers[camera_id]

def adicionar_frame_buffer(camera_id: str, frame):
    buf = get_buffer(camera_id)
    if len(buf) == buf.maxlen:
        try: os.remove(buf[0])
        except: pass
    path = f"/tmp/buf_{camera_id}_{int(time.time()*1000)}.jpg"
    try:
        cv2.imwrite(path, frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        buf.append(path)
    except Exception as e:
        print(f"[BUFFER] Erro ao salvar frame: {e}", flush=True)

def gravar_e_fazer_upload_clipe(camera_id: str, rtsp_url: str, evento_id: str):
    buf = get_buffer(camera_id)
    paths_pre = []
    for i, p in enumerate(list(buf)):
        try:
            import shutil
            dst = f"/tmp/pre_{evento_id}_{i}.jpg"
            shutil.copy2(p, dst)
            paths_pre.append(dst)
        except: pass

    paths_pos = []
    deadline  = time.time() + POS_EVENTO_SEG
    vistos    = set()
    while time.time() < deadline:
        buf = get_buffer(camera_id)
        for p in list(buf):
            if p not in vistos and os.path.exists(p):
                vistos.add(p)
                dst = f"/tmp/pos_{evento_id}_{len(paths_pos)}.jpg"
                try:
                    import shutil
                    shutil.copy2(p, dst)
                    paths_pos.append(dst)
                except: pass
        time.sleep(0.1)

    todos_paths = paths_pre + paths_pos
    print(f"[CLIPE] {len(todos_paths)} frames ({len(paths_pre)} pre + {len(paths_pos)} pos)", flush=True)
    if not todos_paths:
        return None

    tmp      = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp_path = tmp.name
    tmp.close()
    tmp_avi  = tmp_path.replace(".mp4", ".avi")

    try:
        primeiro = cv2.imdecode(np.frombuffer(open(todos_paths[0], 'rb').read(), dtype=np.uint8), cv2.IMREAD_COLOR)
        if primeiro is None:
            return None
        h, w = primeiro.shape[:2]
        fourcc = cv2.VideoWriter_fourcc(*"MJPG")
        out    = cv2.VideoWriter(tmp_avi, fourcc, FPS_BUFFER, (w, h))
        for p in todos_paths:
            try:
                f = cv2.imdecode(np.frombuffer(open(p, 'rb').read(), dtype=np.uint8), cv2.IMREAD_COLOR)
                if f is not None: out.write(f)
            except: pass
        out.release()

        result = subprocess.run([
            "ffmpeg", "-y", "-i", tmp_avi,
            "-vcodec", "libx264", "-preset", "ultrafast",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp_path
        ], capture_output=True, timeout=60)

        if result.returncode != 0:
            print(f"[CLIPE] Erro ffmpeg: {result.stderr.decode()}", flush=True)
            return None

        supabase     = get_supabase()
        dia_slot = ((datetime.now(timezone.utc).day - 1) % 10) + 1  # slot 1-10 ciclico
        storage_path = f"eventos/{camera_id}/dia_{dia_slot:02d}.mp4"
        with open(tmp_path, "rb") as f:
            video_bytes = f.read()
        supabase.storage.from_("event-clips").upload(
            path=storage_path, file=video_bytes,
            file_options={"content-type": "video/mp4", "upsert": "true"}
        )
        url = supabase.storage.from_("event-clips").get_public_url(storage_path)
        print(f"[CLIPE] Upload OK -> {url}", flush=True)
        return url
    except Exception as e:
        print(f"[CLIPE] Erro upload: {e}", flush=True)
        return None
    finally:
        for p in [tmp_avi, tmp_path] + paths_pos + paths_pre:
            try: os.remove(p)
            except: pass


def _decimal_para_hora(decimal: float) -> str:
    h = int(decimal); m = int((decimal - h) * 60)
    return f"{h:02d}:{m:02d}"

def _decimal_para_time_str(decimal: float) -> str:
    h = int(decimal); m = int((decimal - h) * 60)
    return f"{h:02d}:{m:02d}:00"

def _atualizar_perfil_e_alertar(camera_id, empresa_id, tipo, hora_atual, horario_evento):
    try:
        supabase = get_supabase()
        registros = supabase.table("habitos_registros").select("metadata").eq("camera_id", camera_id).eq("tipo", tipo).order("horario_evento", desc=True).limit(30).execute()
        horas = []
        for r in registros.data or []:
            meta = r.get("metadata") or {}
            h    = meta.get("hora_decimal")
            if h is not None: horas.append(float(h))
        n = len(horas)
        if n == 0: return
        media     = sum(horas) / n
        desvio    = math.sqrt(sum((h - media) ** 2 for h in horas) / max(n - 1, 1)) if n > 1 else 0.0
        threshold = media + max(THRESHOLD_MULTIPLIER * desvio, TOLERANCIA_MINIMA_MIN / 60.0)
        aprendizado_completo = n >= MIN_AMOSTRAS
        supabase.table("habitos_perfil").upsert({
            "camera_id": camera_id, "empresa_id": empresa_id, "pessoa_id": "default",
            "tipo": tipo, "hora_media": round(media, 4), "desvio_padrao": round(desvio, 4),
            "threshold_alerta": round(threshold, 4), "amostras_count": n,
            "aprendizado_completo": aprendizado_completo,
            "ultima_atualizacao": datetime.now(timezone.utc).isoformat()
        }, on_conflict="camera_id,pessoa_id,tipo").execute()
        if not aprendizado_completo or hora_atual <= threshold: return
        desvio_minutos = int((hora_atual - media) * 60)
        hoje           = horario_evento.date().isoformat()
        existente = supabase.table("habitos_alertas").select("id").eq("camera_id", camera_id).eq("tipo", tipo).gte("created_at", f"{hoje}T00:00:00Z").execute()
        if existente.data: return
        supabase.table("habitos_alertas").insert({
            "camera_id": camera_id, "empresa_id": empresa_id, "pessoa_id": "default",
            "tipo": tipo, "horario_esperado": _decimal_para_time_str(threshold),
            "horario_real": _decimal_para_time_str(hora_atual),
            "desvio_minutos": desvio_minutos, "status": "pendente"
        }).execute()
    except Exception as e:
        print(f"[HABITOS] Erro _atualizar_perfil: {e}", flush=True)

def registrar_habito_sono(camera_id, empresa_id, horario):
    hora_decimal = horario.hour + horario.minute / 60.0
    if not (4 <= hora_decimal <= 11): return
    try:
        supabase = get_supabase()
        hoje     = horario.date().isoformat()
        existente = supabase.table("habitos_registros").select("id").eq("camera_id", camera_id).eq("tipo", "sono").gte("horario_evento", f"{hoje}T00:00:00Z").execute()
        if existente.data: return
        supabase.table("habitos_registros").insert({"camera_id": camera_id, "empresa_id": empresa_id, "tipo": "sono", "horario_evento": horario.isoformat(), "metadata": {"hora_decimal": hora_decimal}}).execute()
        print(f"[HABITOS] Sono registrado: {horario.strftime('%H:%M')}", flush=True)
        _atualizar_perfil_e_alertar(camera_id, empresa_id, "sono", hora_decimal, horario)
    except Exception as e:
        print(f"[HABITOS] Erro sono: {e}", flush=True)

def registrar_habito_banho(camera_id, empresa_id, horario_inicio, duracao_minutos):
    if duracao_minutos < BANHO_DURACAO_MIN: return
    hora_decimal = horario_inicio.hour + horario_inicio.minute / 60.0
    try:
        supabase = get_supabase()
        hoje     = horario_inicio.date().isoformat()
        existente = supabase.table("habitos_registros").select("id").eq("camera_id", camera_id).eq("tipo", "banho").gte("horario_evento", f"{hoje}T00:00:00Z").execute()
        if existente.data: return
        supabase.table("habitos_registros").insert({"camera_id": camera_id, "empresa_id": empresa_id, "tipo": "banho", "horario_evento": horario_inicio.isoformat(), "duracao_minutos": duracao_minutos, "metadata": {"hora_decimal": hora_decimal}}).execute()
        print(f"[HABITOS] Banho registrado: {horario_inicio.strftime('%H:%M')} por {duracao_minutos}min", flush=True)
        _atualizar_perfil_e_alertar(camera_id, empresa_id, "banho", hora_decimal, horario_inicio)
    except Exception as e:
        print(f"[HABITOS] Erro banho: {e}", flush=True)

def registrar_habito_refeicao(camera_id, empresa_id, horario, duracao_minutos):
    hora_decimal = horario.hour + horario.minute / 60.0
    try:
        supabase = get_supabase()
        supabase.table("habitos_registros").insert({"camera_id": camera_id, "empresa_id": empresa_id, "tipo": "refeicao", "horario_evento": horario.isoformat(), "duracao_minutos": duracao_minutos, "metadata": {"hora_decimal": hora_decimal}}).execute()
        print(f"[HABITOS] Refeicao registrada: {horario.strftime('%H:%M')} por {duracao_minutos}min", flush=True)
        _atualizar_perfil_e_alertar(camera_id, empresa_id, "refeicao", hora_decimal, horario)
    except Exception as e:
        print(f"[HABITOS] Erro refeicao: {e}", flush=True)

def verificar_habitos_ausentes():
    try:
        supabase   = get_supabase()
        agora      = datetime.now(timezone.utc)
        hora_agora = agora.hour + agora.minute / 60.0
        hoje       = agora.date().isoformat()
        perfis = supabase.table("habitos_perfil").select("*").eq("aprendizado_completo", True).execute()
        for perfil in (perfis.data or []):
            tipo = perfil["tipo"]; threshold = perfil["threshold_alerta"]
            camera_id = perfil["camera_id"]; empresa_id = perfil["empresa_id"]
            if hora_agora <= threshold: continue
            ocorreu = supabase.table("habitos_registros").select("id").eq("camera_id", camera_id).eq("tipo", tipo).gte("horario_evento", f"{hoje}T00:00:00Z").execute()
            if ocorreu.data: continue
            alerta_existente = supabase.table("habitos_alertas").select("id").eq("camera_id", camera_id).eq("tipo", tipo).gte("created_at", f"{hoje}T00:00:00Z").execute()
            if alerta_existente.data: continue
            desvio_minutos = int((hora_agora - perfil["hora_media"]) * 60)
            supabase.table("habitos_alertas").insert({"camera_id": camera_id, "empresa_id": empresa_id, "pessoa_id": perfil["pessoa_id"], "tipo": tipo, "horario_esperado": _decimal_para_time_str(threshold), "horario_real": None, "desvio_minutos": desvio_minutos, "status": "pendente"}).execute()
            print(f"[HABITOS] AUSENCIA {tipo} | camera {camera_id} | atraso {desvio_minutos}min", flush=True)
    except Exception as e:
        print(f"[HABITOS] Erro verificar_ausentes: {e}", flush=True)

def thread_verificacao_habitos():
    print("[HABITOS] Thread de verificacao iniciada (a cada 5min)", flush=True)
    while True:
        time.sleep(300)
        verificar_habitos_ausentes()


def capturar_frame(rtsp_url):
    cmd = ["ffmpeg", "-rtsp_transport", "tcp", "-i", rtsp_url, "-frames:v", "1", "-f", "image2", "-vcodec", "mjpeg", "pipe:1"]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=15)
        if result.returncode == 0 and len(result.stdout) > 0:
            return result.stdout
    except Exception as e:
        print(f"Erro ffmpeg: {e}", flush=True)
    return None


_frame_atual: dict = {}
_frame_lock = threading.Lock()

def set_frame_atual(camera_id: str, frame):
    with _frame_lock:
        _frame_atual[camera_id] = frame

def get_frame_atual(camera_id: str):
    with _frame_lock:
        return _frame_atual.get(camera_id)


_captura_status: dict = {}

def _thread_captura_continua(camera_id: str, rtsp_url: str):
    SOI = b"\xff\xd8"; EOI = b"\xff\xd9"
    print(f"[CAPTURA] Thread iniciada para {camera_id}", flush=True)
    while _captura_status.get(camera_id, {}).get("rodando"):
        proc = None
        try:
            cmd = [
                "ffmpeg", "-rtsp_transport", "tcp", "-threads", "1", "-i", rtsp_url,
                "-map", "0:v", "-vf", f"fps={FPS_BUFFER}", "-q:v", "8", "-threads", "1",
                "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
            ]
            if MEDIAMTX_PUBLISH_SECRET:
                # Segunda saida no MESMO processo ffmpeg (nao abre conexao nova
                # na camera/DVR nem processo extra - evita esgotar threads/processos
                # do container com muitas cameras, como ja aconteceu antes).
                # -threads 1 em cada saida: com 11 cameras rodando simultaneamente,
                # os encoders multi-thread padrao esgotavam threads do container
                # ("Resource temporarily unavailable").
                cmd += [
                    "-map", "0:v",
                    "-vf", f"fps={FPS_BUFFER},scale=trunc(iw/2)*2:trunc(ih/2)*2",
                    "-c:v", "libx264", "-preset", "ultrafast",
                    "-tune", "zerolatency", "-pix_fmt", "yuv420p", "-threads", "1",
                    "-f", "flv", _destino_publish_rtmp(camera_id),
                ]
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            print(f"[CAPTURA] Conexao RTSP aberta {camera_id} @ {FPS_BUFFER}fps", flush=True)

            def _drenar_stderr_captura(p, cid):
                # Dreno continuamente para nunca encher o buffer do pipe
                for linha in iter(p.stderr.readline, b''):
                    if not linha:
                        break
                    texto = linha.decode('utf-8', errors='ignore').strip()
                    if texto:
                        print(f"[CAPTURA-ERR] {cid}: {texto}", flush=True)
            threading.Thread(target=_drenar_stderr_captura, args=(proc, camera_id), daemon=True).start()

            buffer = b""
            while _captura_status.get(camera_id, {}).get("rodando"):
                chunk = proc.stdout.read(16384)
                if not chunk: break
                buffer += chunk
                while True:
                    start = buffer.find(SOI)
                    if start == -1: buffer = b""; break
                    end = buffer.find(EOI, start)
                    if end == -1: buffer = buffer[start:]; break
                    frame_data = buffer[start:end + 2]
                    buffer     = buffer[end + 2:]
                    if len(frame_data) > 1000:
                        arr   = np.frombuffer(frame_data, dtype=np.uint8)
                        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                        if frame is not None:
                            adicionar_frame_buffer(camera_id, frame)
                            set_frame_atual(camera_id, frame)
                            agendar_publish(camera_id, frame)
        except Exception as e:
            print(f"[CAPTURA] Erro {camera_id}: {e}", flush=True)
        finally:
            if proc:
                try: proc.terminate()
                except: pass
        if _captura_status.get(camera_id, {}).get("rodando"):
            time.sleep(3)
    print(f"[CAPTURA] Thread encerrada para {camera_id}", flush=True)

def iniciar_captura_continua(camera_id: str, rtsp_url: str):
    if _captura_status.get(camera_id, {}).get("rodando"): return
    _captura_status[camera_id] = {"rodando": True}
    threading.Thread(target=_thread_captura_continua, args=(camera_id, rtsp_url), daemon=True).start()


def pessoa_horizontal(box, keypoints):
    x1, y1, x2, y2 = box
    largura = x2 - x1; altura = y2 - y1
    if altura == 0 or largura == 0: return False
    if (altura / largura) < 0.8: return True
    if keypoints is not None and len(keypoints) >= 17:
        kp = keypoints
        ombro_y = tornozelo_y = None
        if kp[OMBRO_ESQ][2] > 0.3 and kp[OMBRO_DIR][2] > 0.3:
            ombro_y = (kp[OMBRO_ESQ][1] + kp[OMBRO_DIR][1]) / 2
        if kp[TORNOZELO_ESQ][2] > 0.3 and kp[TORNOZELO_DIR][2] > 0.3:
            tornozelo_y = (kp[TORNOZELO_ESQ][1] + kp[TORNOZELO_DIR][1]) / 2
        if ombro_y is not None and tornozelo_y is not None:
            if abs(tornozelo_y - ombro_y) < altura * 0.3: return True
    return False

def pessoa_na_regiao(cx, cy, regiao):
    return (regiao["x1"] <= cx <= regiao["x2"] and regiao["y1"] <= cy <= regiao["y2"])

def lado_da_linha(px, py, x1, y1, x2, y2):
    return (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)

def salvar_evento(camera_id, tipo, confianca, nome, rtsp_url=""):
    try:
        resp = requests.post(f"{API_BASE}/eventos/", json={"camera_id": camera_id, "tipo": tipo, "confianca": round(confianca, 2)}, timeout=3)
        evento_id = None
        try: evento_id = resp.json().get("id")
        except: pass
        print(f"[{nome}] {tipo} ({confianca:.0%})", flush=True)
        if evento_id and rtsp_url:
            def _gravar(eid=evento_id, cid=camera_id, rurl=rtsp_url):
                url = gravar_e_fazer_upload_clipe(cid, rurl, str(eid))
                if url:
                    try:
                        requests.patch(f"{API_BASE}/eventos/{eid}", json={"video_url": url}, timeout=5)
                        print(f"[CLIPE] Evento {eid} atualizado com video", flush=True)
                    except Exception as e:
                        print(f"[CLIPE] Erro ao atualizar evento: {e}", flush=True)
            _clipe_pool.submit(_gravar)
    except Exception as e:
        print(f"[{nome}] Erro evento: {e}", flush=True)

def enviar_heatmap(camera_id, acumulador, nome):
    if not acumulador: return
    pontos = [{"x": round(x, 3), "y": round(y, 3), "peso": float(p)} for (x, y), p in acumulador.items()]
    try:
        requests.post(f"{API_BASE}/heatmap/batch", json={"camera_id": camera_id, "pontos": pontos}, timeout=5)
        print(f"[{nome}] Heatmap: {len(pontos)} pontos enviados", flush=True)
    except Exception as e:
        print(f"[{nome}] Erro heatmap: {e}", flush=True)

def buscar_configuracoes(camera_id):
    linha = None; regioes = []
    try:
        r = requests.get(f"{API_BASE}/contagem/{camera_id}", timeout=5)
        if r.status_code == 200: linha = r.json()
    except: pass
    try:
        r = requests.get(f"{API_BASE}/regioes/{camera_id}", timeout=5)
        if r.status_code == 200: regioes = r.json()
    except: pass
    return linha, regioes

def buscar_analiticos(camera_id: str) -> dict:
    try:
        supabase = get_supabase()
        res = supabase.table("camera_analiticos").select("*").eq("camera_id", camera_id).execute()
        if res.data: return res.data[0]
    except Exception as e:
        print(f"[ANALITICOS] Erro ao buscar {camera_id}: {e}", flush=True)
    return {
        "queda_leito": False, "queda_pe": False, "pessoa": False,
        "banheiro_tempo": False, "gesto_socorro": False,
        "linha_contagem": False, "habitos": False,
        "freezer": False, "caixa": False, "copos": False
    }

def iou(boxA, boxB):
    xA = max(boxA[0], boxB[0]); yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2]); yB = min(boxA[3], boxB[3])
    inter = max(0, xB - xA) * max(0, yB - yA)
    if inter == 0: return 0
    areaA = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
    areaB = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
    return inter / (areaA + areaB - inter)


# ---------------------------------------------------------
# DETECCAO DE NIVEL DO FREEZER
# ---------------------------------------------------------
_ultimo_freezer: dict = {}
FREEZER_INTERVALO = 300

def analisar_nivel_freezer(frame, camera_id: str, empresa_id: str, regioes=None):
    agora = time.time()
    if agora - _ultimo_freezer.get(camera_id, 0) < FREEZER_INTERVALO:
        return
    _ultimo_freezer[camera_id] = agora
    try:
        h, w = frame.shape[:2]
        alvo = frame
        # Recorta para a regiao do tipo "freezer" desenhada na tela, se existir
        if regioes:
            regiao = next((r for r in regioes if r.get("tipo") == "freezer"), None)
            if regiao:
                x1 = max(0, min(w - 1, int(regiao["x1"] * w)))
                x2 = max(0, min(w,     int(regiao["x2"] * w)))
                y1 = max(0, min(h - 1, int(regiao["y1"] * h)))
                y2 = max(0, min(h,     int(regiao["y2"] * h)))
                if x2 > x1 and y2 > y1:
                    alvo = frame[y1:y2, x1:x2]
                else:
                    print(f"[FREEZER] {camera_id} regiao invalida, usando frame inteiro", flush=True)
            else:
                print(f"[FREEZER] {camera_id} sem regiao 'freezer' definida, usando frame inteiro", flush=True)

        pequeno = cv2.resize(alvo, (160, 120))
        hsv = cv2.cvtColor(pequeno, cv2.COLOR_BGR2HSV)
        mask_branco = cv2.inRange(hsv, np.array([0, 0, 180]), np.array([180, 40, 255]))
        mask_cinza  = cv2.inRange(hsv, np.array([0, 0, 80]),  np.array([180, 30, 200]))
        mask_fundo  = cv2.bitwise_or(mask_branco, mask_cinza)
        total  = pequeno.shape[0] * pequeno.shape[1]
        fundo  = cv2.countNonZero(mask_fundo)
        nivel  = int(((total - fundo) / total) * 100)
        nivel  = max(0, min(100, nivel))
        print(f"[FREEZER] {camera_id} nivel={nivel}%", flush=True)
        requests.post(f"{API_BASE}/freezer/status", json={
            "camera_id": camera_id, "empresa_id": empresa_id, "nivel_percentual": nivel,
        }, timeout=3)
    except Exception as e:
        print(f"[FREEZER] Erro {camera_id}: {e}", flush=True)


# ---------------------------------------------------------
# DETECCAO DE CEDULAS NO CAIXA
# ---------------------------------------------------------
# Cedulas brasileiras por faixa de cor HSV
CEDULAS_HSV = [
    ((100, 130, 80, 80),   2),
    ((130, 160, 60, 60),   5),
    ((0,   15, 100, 80),  10),
    ((15,  35, 120, 100), 20),
    ((10,  25, 150, 100), 50),
    ((95, 115, 80, 120),  100),
    ((35,  75, 40, 80),   200),
]

_ultimo_caixa: dict = {}
CAIXA_COOLDOWN = 5


def detectar_cedula_por_cor(frame):
    h, w = frame.shape[:2]
    roi = frame[h//4:3*h//4, w//4:3*w//4]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    melhor_valor = None
    melhor_score = 0
    for (h_min, h_max, s_min, v_min), valor in CEDULAS_HSV:
        mask  = cv2.inRange(hsv, np.array([h_min, s_min, v_min]), np.array([h_max, 255, 255]))
        score = cv2.countNonZero(mask)
        total = roi.shape[0] * roi.shape[1]
        pct   = score / total
        if pct > 0.15 and score > melhor_score:
            melhor_score = score
            melhor_valor = valor
    return melhor_valor


def detectar_maos_no_frame(results) -> bool:
    for result in results:
        if result.keypoints is None: continue
        for kps in result.keypoints.data:
            kps = kps.cpu().numpy()
            if len(kps) > 10 and (kps[9][2] > 0.3 or kps[10][2] > 0.3):
                return True
    return False


def processar_caixa(frame, results, camera_id: str, empresa_id: str):
    agora = time.time()
    if agora - _ultimo_caixa.get(camera_id, 0) < CAIXA_COOLDOWN:
        return
    if not detectar_maos_no_frame(results):
        return
    cedula = detectar_cedula_por_cor(frame)
    if cedula is None:
        return
    try:
        resp = requests.get(f"{API_BASE}/caixa/leitura/{empresa_id}", timeout=2)
        if resp.status_code != 200: return
        leitura = resp.json()
        valor_balanca = leitura.get("valor_balanca", 0)
        if valor_balanca <= 0: return
    except: return

    if cedula < valor_balanca: return

    _ultimo_caixa[camera_id] = agora
    troco_esperado = cedula - valor_balanca
    print(f"[CAIXA] Venda: R${valor_balanca:.2f} | Cedula: R${cedula:.2f} | Troco: R${troco_esperado:.2f}", flush=True)

    time.sleep(3)
    frame2 = get_frame_atual(camera_id)
    troco_detectado = None
    if frame2 is not None:
        troco_detectado = detectar_cedula_por_cor(frame2)

    try:
        requests.post(f"{API_BASE}/caixa/venda", json={
            "empresa_id": empresa_id,
            "camera_id": camera_id,
            "valor_balanca": valor_balanca,
            "cedula_recebida": cedula,
            "troco_calculado": troco_esperado,
            "troco_detectado": troco_detectado,
            "peso_gramas": leitura.get("peso_gramas"),
        }, timeout=5)
    except Exception as e:
        print(f"[CAIXA] Erro registrar venda: {e}", flush=True)


# ---------------------------------------------------------
# DETECCAO DE COMPORTAMENTO SUSPEITO NO CAIXA
# ---------------------------------------------------------
# Heuristica: alerta quando uma mao entra na regiao do "caixa" e, em
# seguida (dentro de uma janela curta de tempo), se aproxima do proprio
# quadril da pessoa - possivel gesto de guardar algo no bolso, sem
# devolver a mao ao caixa. NAO e uma confirmacao de furto: e um alerta
# de comportamento atipico para revisao humana do clipe gravado.
JANELA_SUSPEITA_SEG   = 8     # tempo max. entre "mao no caixa" e "mao perto do quadril"
DIST_BOLSO_MAX        = 0.07  # distancia normalizada (0-1) pulso<->quadril
COOLDOWN_SUSPEITO_SEG = 60

_estado_mao_caixa: dict = {}

def _dist_norm(p1, p2):
    return ((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2) ** 0.5

def detectar_comportamento_suspeito(tid, kps, caixa_regiao, w, h, agora_dt, agora,
                                     camera_id, empresa_id, nome, rtsp_url, conf, cooldowns):
    if kps is None or len(kps) < 17 or caixa_regiao is None:
        return
    estado_tid = _estado_mao_caixa.setdefault(tid, {})

    pulsos = []
    if kps[PULSO_ESQ][2] > 0.3:
        pulsos.append((kps[PULSO_ESQ][0] / w, kps[PULSO_ESQ][1] / h))
    if kps[PULSO_DIR][2] > 0.3:
        pulsos.append((kps[PULSO_DIR][0] / w, kps[PULSO_DIR][1] / h))
    if not pulsos:
        return

    mao_no_caixa = any(pessoa_na_regiao(px, py, caixa_regiao) for px, py in pulsos)
    if mao_no_caixa:
        estado_tid["mao_caixa_em"] = agora_dt
        return

    momento_caixa = estado_tid.get("mao_caixa_em")
    if not momento_caixa:
        return
    if (agora_dt - momento_caixa).total_seconds() > JANELA_SUSPEITA_SEG:
        return

    quadris = []
    if kps[QUADRIL_ESQ][2] > 0.3:
        quadris.append((kps[QUADRIL_ESQ][0] / w, kps[QUADRIL_ESQ][1] / h))
    if kps[QUADRIL_DIR][2] > 0.3:
        quadris.append((kps[QUADRIL_DIR][0] / w, kps[QUADRIL_DIR][1] / h))
    if not quadris:
        return

    perto_do_quadril = any(_dist_norm(p, q) < DIST_BOLSO_MAX for p in pulsos for q in quadris)
    if not perto_do_quadril:
        return

    if agora - cooldowns[tid]["comportamento_suspeito"] < COOLDOWN_SUSPEITO_SEG:
        return

    cooldowns[tid]["comportamento_suspeito"] = agora
    estado_tid["mao_caixa_em"] = None
    salvar_evento(camera_id, "comportamento_suspeito_caixa", conf, nome, rtsp_url)


# ---------------------------------------------------------
# CONTAGEM DE COPOS/POTES NA AREA DESENHADA (ex: em cima da balanca)
# ---------------------------------------------------------
CLASSE_COPO = 41   # 'cup' no COCO
CLASSE_POTE = 45   # 'bowl' no COCO
COPO_CONF_MIN = 0.35

_tracks_copos: dict = {}    # {camera_id: {tid: {"box": [...]}}}
_next_id_copos: dict = {}   # {camera_id: int}

def contar_copos_potes(frame, camera_id: str, nome: str, regiao):
    """
    Detecta copos/potes (classes COCO 'cup' e 'bowl') dentro da regiao
    desenhada e conta cada objeto NOVO que aparece nela, usando um
    tracker simples por IOU para nao contar o mesmo objeto repetidas
    vezes enquanto ele permanece visivel na area.
    """
    if regiao is None:
        return
    try:
        h, w = frame.shape[:2]
        results = model_objetos(frame, verbose=False, classes=[CLASSE_COPO, CLASSE_POTE])

        deteccoes = []
        for result in results:
            for box in result.boxes:
                conf = float(box.conf[0])
                if conf < COPO_CONF_MIN:
                    continue
                coords = box.xyxy[0].cpu().numpy()
                cx = (coords[0] + coords[2]) / 2 / w
                cy = (coords[1] + coords[3]) / 2 / h
                if pessoa_na_regiao(cx, cy, regiao):
                    deteccoes.append({"box": coords, "conf": conf})

        tracks = _tracks_copos.get(camera_id, {})
        usados = set()
        novos_tracks = {}

        for tid, tr in tracks.items():
            melhor_iou = 0.3
            melhor_idx = -1
            for idx, det in enumerate(deteccoes):
                if idx in usados:
                    continue
                score = iou(tr["box"], det["box"])
                if score > melhor_iou:
                    melhor_iou = score
                    melhor_idx = idx
            if melhor_idx >= 0:
                usados.add(melhor_idx)
                novos_tracks[tid] = {"box": deteccoes[melhor_idx]["box"]}

        next_id = _next_id_copos.get(camera_id, 0)
        for idx, det in enumerate(deteccoes):
            if idx in usados:
                continue
            novos_tracks[next_id] = {"box": det["box"]}
            print(f"[COPOS] {nome} novo copo/pote (conf={det['conf']:.0%})", flush=True)
            # rtsp_url="" -> nao grava clipe, evento leve (evita sobrecarga com contagem frequente)
            salvar_evento(camera_id, "copo_pote_contado", det["conf"], nome, "")
            next_id += 1

        _tracks_copos[camera_id] = novos_tracks
        _next_id_copos[camera_id] = next_id
    except Exception as e:
        print(f"[COPOS] Erro {camera_id}: {e}", flush=True)


# ---------------------------------------------------------
# LOOP PRINCIPAL POR CAMERA
# ---------------------------------------------------------
def processar_camera(camera):
    camera_id  = camera["id"]
    nome       = camera["nome"]
    rtsp_url   = camera["rtsp_url"]
    empresa_id = camera.get("empresa_id", "")

    print(f"[{nome}] Iniciando monitoramento...", flush=True)
    iniciar_captura_continua(camera_id, rtsp_url)

    tracks = {}; next_id = 0; linha = None; regioes = []; config_refresh = 0
    heatmap_acc = defaultdict(float); heatmap_ultimo_envio = time.time()
    cooldowns = defaultdict(lambda: defaultdict(float)); COOLDOWN_SEGUNDOS = 30
    presenca_regiao = defaultdict(lambda: defaultdict(dict))
    sono_registrado_hoje = None
    analiticos = buscar_analiticos(camera_id)

    while True:
        try:
            agora    = time.time()
            agora_dt = datetime.now(timezone.utc)

            if agora - config_refresh > 300:
                linha, regioes = buscar_configuracoes(camera_id)
                analiticos     = buscar_analiticos(camera_id)
                config_refresh = agora

            hoje_str = agora_dt.date().isoformat()
            if sono_registrado_hoje != hoje_str:
                sono_registrado_hoje = None

            if agora - heatmap_ultimo_envio > 600:
                enviar_heatmap(camera_id, dict(heatmap_acc), nome)
                heatmap_acc.clear()
                heatmap_ultimo_envio = agora

            frame = get_frame_atual(camera_id)
            if frame is None:
                print(f"[{nome}] Aguardando frame da captura continua...", flush=True)
                time.sleep(2)
                continue

            h, w    = frame.shape[:2]
            results = model_pose(frame, verbose=False)

            cama     = next((r for r in regioes if r["tipo"] == "cama"),     None)
            banheiro = next((r for r in regioes if r["tipo"] == "banheiro"), None)
            cozinha  = next((r for r in regioes if r["tipo"] == "cozinha"),  None)
            quarto   = next((r for r in regioes if r["tipo"] == "quarto"),   None)
            caixa_regiao = next((r for r in regioes if r["tipo"] == "caixa"), None)
            copos_regiao = next((r for r in regioes if r["tipo"] == "copos"), None)

            if analiticos.get("freezer", False):
                analisar_nivel_freezer(frame, camera_id, empresa_id, regioes)

            if analiticos.get("caixa", False):
                processar_caixa(frame, results, camera_id, empresa_id)

            if analiticos.get("copos", False):
                contar_copos_potes(frame, camera_id, nome, copos_regiao)

            deteccoes = []
            for result in results:
                for i, box in enumerate(result.boxes):
                    if int(box.cls[0]) != 0: continue
                    conf = float(box.conf[0])
                    if conf < 0.4: continue
                    coords = box.xyxy[0].cpu().numpy()
                    kps    = None
                    if result.keypoints is not None and i < len(result.keypoints.data):
                        kps = result.keypoints.data[i].cpu().numpy()
                    deteccoes.append({"box": coords, "conf": conf, "kps": kps})

            novos_tracks = {}; usados = set()

            for tid, track in tracks.items():
                melhor_iou = 0.3; melhor_idx = -1
                for idx, det in enumerate(deteccoes):
                    if idx in usados: continue
                    score = iou(track["box"], det["box"])
                    if score > melhor_iou: melhor_iou = score; melhor_idx = idx

                if melhor_idx >= 0:
                    det = deteccoes[melhor_idx]; usados.add(melhor_idx)
                    cx = (det["box"][0] + det["box"][2]) / 2 / w
                    cy = (det["box"][1] + det["box"][3]) / 2 / h
                    hx = round(cx / 0.02) * 0.02; hy = round(cy / 0.02) * 0.02
                    heatmap_acc[(hx, hy)] += 1

                    horizontal     = pessoa_horizontal(det["box"], det["kps"])
                    na_cama        = cama     and pessoa_na_regiao(cx, cy, cama)
                    no_banheiro    = banheiro and pessoa_na_regiao(cx, cy, banheiro)
                    na_cozinha     = cozinha  and pessoa_na_regiao(cx, cy, cozinha)
                    no_quarto      = quarto   and pessoa_na_regiao(cx, cy, quarto)
                    estava_na_cama = track.get("na_cama", False)

                    def pode_alertar(tipo): return agora - cooldowns[tid][tipo] > COOLDOWN_SEGUNDOS
                    def analitico_ativo(key): return analiticos.get(key, False)

                    if caixa_regiao and analitico_ativo("habitos"):
                        detectar_comportamento_suspeito(
                            tid, det["kps"], caixa_regiao, w, h, agora_dt, agora,
                            camera_id, empresa_id, nome, rtsp_url, det["conf"], cooldowns
                        )

                    if estava_na_cama and not na_cama and horizontal:
                        if analitico_ativo("queda_leito") and pode_alertar("queda_leito"):
                            salvar_evento(camera_id, "queda_leito", det["conf"], nome, rtsp_url)
                            cooldowns[tid]["queda_leito"] = agora
                    elif not na_cama and horizontal and not estava_na_cama:
                        if analitico_ativo("queda_pe") and pode_alertar("queda_pe"):
                            salvar_evento(camera_id, "queda_pe", det["conf"], nome, rtsp_url)
                            cooldowns[tid]["queda_pe"] = agora

                    if linha:
                        lado_atual = lado_da_linha(cx, cy, linha["x1"], linha["y1"], linha["x2"], linha["y2"])
                        lado_ant = track.get("lado")
                        if lado_ant is not None and lado_atual != 0:
                            if lado_ant > 0 and lado_atual < 0:
                                if analitico_ativo("linha_contagem"):
                                    salvar_evento(camera_id, "entrada", det["conf"], nome, rtsp_url)
                            elif lado_ant < 0 and lado_atual > 0:
                                if analitico_ativo("linha_contagem"):
                                    salvar_evento(camera_id, "saida", det["conf"], nome, rtsp_url)

                    if not horizontal and not na_cama:
                        if analitico_ativo("pessoa") and pode_alertar("person"):
                            salvar_evento(camera_id, "person", det["conf"], nome, rtsp_url)
                            cooldowns[tid]["person"] = agora

                    if no_quarto and not horizontal and sono_registrado_hoje != hoje_str:
                        if 4 <= agora_dt.hour <= 11:
                            sono_registrado_hoje = hoje_str
                            registrar_habito_sono(camera_id, empresa_id, agora_dt)

                    if no_banheiro:
                        pr = presenca_regiao[tid]["banheiro"]
                        if not pr:
                            presenca_regiao[tid]["banheiro"] = {"inicio": agora_dt, "ultima": agora_dt}
                        else:
                            seg = (agora_dt - pr["ultima"]).total_seconds()
                            if seg <= 30:
                                presenca_regiao[tid]["banheiro"]["ultima"] = agora_dt
                                duracao = (agora_dt - pr["inicio"]).total_seconds() / 60
                                if duracao >= BANHO_DURACAO_MIN and not pr.get("registrado"):
                                    presenca_regiao[tid]["banheiro"]["registrado"] = True
                                    registrar_habito_banho(camera_id, empresa_id, pr["inicio"], int(duracao))
                            else:
                                presenca_regiao[tid]["banheiro"] = {"inicio": agora_dt, "ultima": agora_dt}
                    else:
                        presenca_regiao[tid]["banheiro"] = {}

                    if na_cozinha:
                        pr = presenca_regiao[tid]["cozinha"]
                        if not pr:
                            presenca_regiao[tid]["cozinha"] = {"inicio": agora_dt, "ultima": agora_dt}
                        else:
                            seg = (agora_dt - pr["ultima"]).total_seconds()
                            if seg <= 30:
                                presenca_regiao[tid]["cozinha"]["ultima"] = agora_dt
                                duracao = (agora_dt - pr["inicio"]).total_seconds() / 60
                                if duracao >= COZINHA_DURACAO_MIN and not pr.get("registrado"):
                                    presenca_regiao[tid]["cozinha"]["registrado"] = True
                                    registrar_habito_refeicao(camera_id, empresa_id, pr["inicio"], int(duracao))
                            else:
                                presenca_regiao[tid]["cozinha"] = {"inicio": agora_dt, "ultima": agora_dt}
                    else:
                        presenca_regiao[tid]["cozinha"] = {}

                    novos_tracks[tid] = {
                        "box": det["box"],
                        "lado": lado_da_linha(cx, cy, linha["x1"], linha["y1"], linha["x2"], linha["y2"]) if linha else None,
                        "na_cama": na_cama, "horizontal": horizontal,
                    }

            for idx, det in enumerate(deteccoes):
                if idx not in usados:
                    cx = (det["box"][0] + det["box"][2]) / 2 / w
                    cy = (det["box"][1] + det["box"][3]) / 2 / h
                    hx = round(cx / 0.02) * 0.02; hy = round(cy / 0.02) * 0.02
                    heatmap_acc[(hx, hy)] += 1
                    na_cama  = cama and pessoa_na_regiao(cx, cy, cama)
                    lado_ini = lado_da_linha(cx, cy, linha["x1"], linha["y1"], linha["x2"], linha["y2"]) if linha else None
                    novos_tracks[next_id] = {
                        "box": det["box"], "lado": lado_ini,
                        "na_cama": na_cama, "horizontal": pessoa_horizontal(det["box"], det["kps"]),
                    }
                    next_id += 1

            tracks = novos_tracks
            time.sleep(2)

        except Exception as e:
            print(f"[{nome}] Erro: {e}. Reiniciando em 10s...", flush=True)
            time.sleep(10)


# ---------------------------------------------------------
# MAIN
# ---------------------------------------------------------
def main():
    print("VMS Worker iniciando...", flush=True)
    while True:
        try:
            resp    = requests.get(f"{API_BASE}/cameras/", timeout=10)
            empresa_id_env = os.environ.get('EMPRESA_ID', '')
            cameras = [c for c in resp.json() if c.get('ativo') and c.get('empresa_id') and (not empresa_id_env or c.get('empresa_id') == empresa_id_env)]
            break
        except Exception as e:
            print(f"Erro: {e}. Tentando em 5s...", flush=True)
            time.sleep(5)

    threading.Thread(target=thread_verificacao_habitos, daemon=True).start()

    threads = []
    for camera in cameras:
        t = threading.Thread(target=processar_camera, args=(camera,), daemon=True)
        t.start(); threads.append(t)
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
