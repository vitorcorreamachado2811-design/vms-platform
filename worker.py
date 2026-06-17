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

# Supabase
SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

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

# ─────────────────────────────────────────────
# CONFIGURACOES DE HABITOS
# ─────────────────────────────────────────────
MIN_AMOSTRAS          = 3
THRESHOLD_MULTIPLIER  = 1.5
TOLERANCIA_MINIMA_MIN = 15
BANHO_DURACAO_MIN     = 5
COZINHA_DURACAO_MIN   = 10

# ─────────────────────────────────────────────
# CONFIGURACOES DE CLIPE DE VIDEO
# ─────────────────────────────────────────────
PRE_EVENTO_SEG = 10
POS_EVENTO_SEG = 10
FPS_BUFFER     = 15
MAX_BUFFER     = PRE_EVENTO_SEG * FPS_BUFFER  # 150 frames pre-evento

_buffers: dict = {}

# ─────────────────────────────────────────────
# PUBLISH AO VIVO — pool fixo, sem thread por frame
# ─────────────────────────────────────────────
PUBLISH_INTERVALO = 0.1   # 10fps maximo por camera

_ultimo_publish: dict = {}

# Pool fixo: 1 worker por camera (maximo 8 cameras), nunca cresce
_publish_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="publish")

# Pool fixo para gravacao de clipes — maximo 4 clipes simultaneos
_clipe_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="clipe")

# Flag por camera: evita enfileirar se ja ha um publish em andamento
_publish_em_andamento: dict = {}
_publish_lock = threading.Lock()


def publish_live_frame(camera_id: str, frame):
    """Envia frame JPEG para o backend. Roda dentro do pool fixo."""
    with _publish_lock:
        _publish_em_andamento[camera_id] = False  # libera slot ao entrar

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
    """
    Agenda publish no pool fixo.
    Se ja ha um publish em andamento para esta camera, descarta o frame
    (nao faz sentido enfileirar frames atrasados).
    """
    agora = time.time()
    if agora - _ultimo_publish.get(camera_id, 0) < PUBLISH_INTERVALO:
        return  # ainda dentro do intervalo minimo

    with _publish_lock:
        if _publish_em_andamento.get(camera_id, False):
            return  # ja ha um publish rodando, descarta
        _publish_em_andamento[camera_id] = True

    _ultimo_publish[camera_id] = agora
    _publish_pool.submit(publish_live_frame, camera_id, frame.copy())


# ── HLS STREAMING ──────────────────────────────────────────────────────────────
_hls_processos: dict = {}

def iniciar_hls(camera_id: str, rtsp_url: str):
    if camera_id in _hls_processos:
        try:
            _hls_processos[camera_id].kill()
        except:
            pass
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
        try:
            _hls_processos[camera_id].kill()
        except:
            pass
        del _hls_processos[camera_id]


# ─────────────────────────────────────────────
# SUPABASE CLIENT
# ─────────────────────────────────────────────
def get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ─────────────────────────────────────────────
# FUNCOES DE BUFFER E CLIPE
# ─────────────────────────────────────────────
def get_buffer(camera_id: str) -> collections.deque:
    if camera_id not in _buffers:
        _buffers[camera_id] = collections.deque(maxlen=MAX_BUFFER)
    return _buffers[camera_id]

def adicionar_frame_buffer(camera_id: str, frame):
    buf = get_buffer(camera_id)
    if len(buf) == buf.maxlen:
        try:
            os.remove(buf[0])
        except:
            pass
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
        except:
            pass

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
                except:
                    pass
        time.sleep(0.1)

    todos_paths = paths_pre + paths_pos
    n_frames    = len(todos_paths)
    print(f"[CLIPE] {n_frames} frames ({len(paths_pre)} pre + {len(paths_pos)} pos)", flush=True)

    if not todos_paths:
        print(f"[CLIPE] Sem frames para evento {evento_id}", flush=True)
        return None

    tmp      = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp_path = tmp.name
    tmp.close()
    tmp_avi  = tmp_path.replace(".mp4", ".avi")

    try:
        primeiro = cv2.imdecode(
            np.frombuffer(open(todos_paths[0], 'rb').read(), dtype=np.uint8),
            cv2.IMREAD_COLOR
        )
        if primeiro is None:
            return None
        h, w = primeiro.shape[:2]

        fourcc = cv2.VideoWriter_fourcc(*"MJPG")
        out    = cv2.VideoWriter(tmp_avi, fourcc, FPS_BUFFER, (w, h))
        for p in todos_paths:
            try:
                f = cv2.imdecode(
                    np.frombuffer(open(p, 'rb').read(), dtype=np.uint8),
                    cv2.IMREAD_COLOR
                )
                if f is not None:
                    out.write(f)
            except:
                pass
        out.release()

        result = subprocess.run([
            "ffmpeg", "-y",
            "-i", tmp_avi,
            "-vcodec", "libx264",
            "-preset", "ultrafast",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            tmp_path
        ], capture_output=True, timeout=60)

        if result.returncode != 0:
            print(f"[CLIPE] Erro ffmpeg: {result.stderr.decode()}", flush=True)
            return None

        supabase     = get_supabase()
        storage_path = f"eventos/{camera_id}/{evento_id}.mp4"

        with open(tmp_path, "rb") as f:
            video_bytes = f.read()

        supabase.storage.from_("event-clips").upload(
            path=storage_path,
            file=video_bytes,
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
            try:
                os.remove(p)
            except:
                pass


# ─────────────────────────────────────────────
# MODULO DE HABITOS
# ─────────────────────────────────────────────
def _decimal_para_hora(decimal: float) -> str:
    h = int(decimal)
    m = int((decimal - h) * 60)
    return f"{h:02d}:{m:02d}"

def _decimal_para_time_str(decimal: float) -> str:
    h = int(decimal)
    m = int((decimal - h) * 60)
    return f"{h:02d}:{m:02d}:00"

def _atualizar_perfil_e_alertar(camera_id, empresa_id, tipo, hora_atual, horario_evento):
    try:
        supabase = get_supabase()
        registros = supabase.table("habitos_registros").select(
            "metadata"
        ).eq("camera_id", camera_id).eq("tipo", tipo).order(
            "horario_evento", desc=True
        ).limit(30).execute()

        horas = []
        for r in registros.data or []:
            meta = r.get("metadata") or {}
            h    = meta.get("hora_decimal")
            if h is not None:
                horas.append(float(h))

        n = len(horas)
        if n == 0:
            return

        media     = sum(horas) / n
        desvio    = math.sqrt(sum((h - media) ** 2 for h in horas) / max(n - 1, 1)) if n > 1 else 0.0
        threshold = media + max(THRESHOLD_MULTIPLIER * desvio, TOLERANCIA_MINIMA_MIN / 60.0)
        aprendizado_completo = n >= MIN_AMOSTRAS

        supabase.table("habitos_perfil").upsert({
            "camera_id": camera_id,
            "empresa_id": empresa_id,
            "pessoa_id": "default",
            "tipo": tipo,
            "hora_media": round(media, 4),
            "desvio_padrao": round(desvio, 4),
            "threshold_alerta": round(threshold, 4),
            "amostras_count": n,
            "aprendizado_completo": aprendizado_completo,
            "ultima_atualizacao": datetime.now(timezone.utc).isoformat()
        }, on_conflict="camera_id,pessoa_id,tipo").execute()

        print(
            f"[HABITOS] {tipo} | media={_decimal_para_hora(media)} "
            f"desvio=+-{desvio*60:.0f}min threshold={_decimal_para_hora(threshold)} "
            f"amostras={n}",
            flush=True
        )

        if not aprendizado_completo or hora_atual <= threshold:
            return

        desvio_minutos = int((hora_atual - media) * 60)
        hoje           = horario_evento.date().isoformat()

        existente = supabase.table("habitos_alertas").select("id").eq(
            "camera_id", camera_id
        ).eq("tipo", tipo).gte("created_at", f"{hoje}T00:00:00Z").execute()

        if existente.data:
            return

        supabase.table("habitos_alertas").insert({
            "camera_id": camera_id,
            "empresa_id": empresa_id,
            "pessoa_id": "default",
            "tipo": tipo,
            "horario_esperado": _decimal_para_time_str(threshold),
            "horario_real": _decimal_para_time_str(hora_atual),
            "desvio_minutos": desvio_minutos,
            "status": "pendente"
        }).execute()

        print(
            f"[HABITOS] ALERTA {tipo} | esperado ate {_decimal_para_hora(threshold)} "
            f"| ocorreu {_decimal_para_hora(hora_atual)} | atraso {desvio_minutos}min",
            flush=True
        )

    except Exception as e:
        print(f"[HABITOS] Erro _atualizar_perfil: {e}", flush=True)

def registrar_habito_sono(camera_id, empresa_id, horario):
    hora_decimal = horario.hour + horario.minute / 60.0
    if not (4 <= hora_decimal <= 11):
        return
    try:
        supabase = get_supabase()
        hoje     = horario.date().isoformat()
        existente = supabase.table("habitos_registros").select("id").eq(
            "camera_id", camera_id
        ).eq("tipo", "sono").gte("horario_evento", f"{hoje}T00:00:00Z").execute()
        if existente.data:
            return
        supabase.table("habitos_registros").insert({
            "camera_id": camera_id,
            "empresa_id": empresa_id,
            "tipo": "sono",
            "horario_evento": horario.isoformat(),
            "metadata": {"hora_decimal": hora_decimal}
        }).execute()
        print(f"[HABITOS] Sono registrado: {horario.strftime('%H:%M')}", flush=True)
        _atualizar_perfil_e_alertar(camera_id, empresa_id, "sono", hora_decimal, horario)
    except Exception as e:
        print(f"[HABITOS] Erro sono: {e}", flush=True)

def registrar_habito_banho(camera_id, empresa_id, horario_inicio, duracao_minutos):
    if duracao_minutos < BANHO_DURACAO_MIN:
        return
    hora_decimal = horario_inicio.hour + horario_inicio.minute / 60.0
    try:
        supabase = get_supabase()
        hoje     = horario_inicio.date().isoformat()
        existente = supabase.table("habitos_registros").select("id").eq(
            "camera_id", camera_id
        ).eq("tipo", "banho").gte("horario_evento", f"{hoje}T00:00:00Z").execute()
        if existente.data:
            return
        supabase.table("habitos_registros").insert({
            "camera_id": camera_id,
            "empresa_id": empresa_id,
            "tipo": "banho",
            "horario_evento": horario_inicio.isoformat(),
            "duracao_minutos": duracao_minutos,
            "metadata": {"hora_decimal": hora_decimal}
        }).execute()
        print(f"[HABITOS] Banho registrado: {horario_inicio.strftime('%H:%M')} por {duracao_minutos}min", flush=True)
        _atualizar_perfil_e_alertar(camera_id, empresa_id, "banho", hora_decimal, horario_inicio)
    except Exception as e:
        print(f"[HABITOS] Erro banho: {e}", flush=True)

def registrar_habito_refeicao(camera_id, empresa_id, horario, duracao_minutos):
    hora_decimal = horario.hour + horario.minute / 60.0
    try:
        supabase = get_supabase()
        supabase.table("habitos_registros").insert({
            "camera_id": camera_id,
            "empresa_id": empresa_id,
            "tipo": "refeicao",
            "horario_evento": horario.isoformat(),
            "duracao_minutos": duracao_minutos,
            "metadata": {"hora_decimal": hora_decimal}
        }).execute()
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

        perfis = supabase.table("habitos_perfil").select("*").eq(
            "aprendizado_completo", True
        ).execute()

        for perfil in (perfis.data or []):
            tipo       = perfil["tipo"]
            threshold  = perfil["threshold_alerta"]
            camera_id  = perfil["camera_id"]
            empresa_id = perfil["empresa_id"]

            if hora_agora <= threshold:
                continue

            ocorreu = supabase.table("habitos_registros").select("id").eq(
                "camera_id", camera_id
            ).eq("tipo", tipo).gte("horario_evento", f"{hoje}T00:00:00Z").execute()
            if ocorreu.data:
                continue

            alerta_existente = supabase.table("habitos_alertas").select("id").eq(
                "camera_id", camera_id
            ).eq("tipo", tipo).gte("created_at", f"{hoje}T00:00:00Z").execute()
            if alerta_existente.data:
                continue

            desvio_minutos = int((hora_agora - perfil["hora_media"]) * 60)
            supabase.table("habitos_alertas").insert({
                "camera_id": camera_id,
                "empresa_id": empresa_id,
                "pessoa_id": perfil["pessoa_id"],
                "tipo": tipo,
                "horario_esperado": _decimal_para_time_str(threshold),
                "horario_real": None,
                "desvio_minutos": desvio_minutos,
                "status": "pendente"
            }).execute()

            print(
                f"[HABITOS] AUSENCIA {tipo} nao ocorreu | "
                f"camera {camera_id} | atraso {desvio_minutos}min",
                flush=True
            )

    except Exception as e:
        print(f"[HABITOS] Erro verificar_ausentes: {e}", flush=True)

def thread_verificacao_habitos():
    print("[HABITOS] Thread de verificacao iniciada (a cada 5min)", flush=True)
    while True:
        time.sleep(300)
        verificar_habitos_ausentes()


# ─────────────────────────────────────────────
# CAPTURA DE FRAME UNICO (para loop YOLO)
# ─────────────────────────────────────────────
def capturar_frame(rtsp_url):
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


# ─────────────────────────────────────────────
# FRAME MAIS RECENTE POR CAMERA
# Loop YOLO le daqui em vez de abrir nova conexao RTSP
# ─────────────────────────────────────────────
_frame_atual: dict = {}   # {camera_id: np.ndarray}
_frame_lock = threading.Lock()

def set_frame_atual(camera_id: str, frame):
    with _frame_lock:
        _frame_atual[camera_id] = frame

def get_frame_atual(camera_id: str):
    with _frame_lock:
        return _frame_atual.get(camera_id)

# ─────────────────────────────────────────────
# THREAD DE CAPTURA CONTINUA (buffer + ao vivo)
# ─────────────────────────────────────────────
_captura_status: dict = {}

def _thread_captura_continua(camera_id: str, rtsp_url: str):
    SOI = b"\xff\xd8"
    EOI = b"\xff\xd9"
    print(f"[CAPTURA] Thread iniciada para {camera_id}", flush=True)

    while _captura_status.get(camera_id, {}).get("rodando"):
        proc = None
        try:
            proc = subprocess.Popen([
                "ffmpeg",
                "-rtsp_transport", "tcp",
                "-i", rtsp_url,
                "-vf", f"fps={FPS_BUFFER}",
                "-q:v", "8",
                "-f", "image2pipe",
                "-vcodec", "mjpeg",
                "pipe:1"
            ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

            print(f"[CAPTURA] Conexao RTSP aberta {camera_id} @ {FPS_BUFFER}fps", flush=True)
            buffer = b""

            while _captura_status.get(camera_id, {}).get("rodando"):
                chunk = proc.stdout.read(16384)
                if not chunk:
                    break
                buffer += chunk

                while True:
                    start = buffer.find(SOI)
                    if start == -1:
                        buffer = b""
                        break
                    end = buffer.find(EOI, start)
                    if end == -1:
                        buffer = buffer[start:]
                        break
                    frame_data = buffer[start:end + 2]
                    buffer     = buffer[end + 2:]
                    if len(frame_data) > 1000:
                        arr   = np.frombuffer(frame_data, dtype=np.uint8)
                        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                        if frame is not None:
                            adicionar_frame_buffer(camera_id, frame)
                            set_frame_atual(camera_id, frame)
                            # Usa pool fixo — nunca cria thread nova
                            agendar_publish(camera_id, frame)

        except Exception as e:
            print(f"[CAPTURA] Erro {camera_id}: {e}", flush=True)
        finally:
            if proc:
                try:
                    proc.terminate()
                except:
                    pass

        if _captura_status.get(camera_id, {}).get("rodando"):
            time.sleep(3)

    print(f"[CAPTURA] Thread encerrada para {camera_id}", flush=True)

def iniciar_captura_continua(camera_id: str, rtsp_url: str):
    if _captura_status.get(camera_id, {}).get("rodando"):
        return
    _captura_status[camera_id] = {"rodando": True}
    threading.Thread(target=iniciar_hls, args=(camera_id, rtsp_url), daemon=True).start()
    threading.Thread(
        target=_thread_captura_continua,
        args=(camera_id, rtsp_url),
        daemon=True
    ).start()


# ─────────────────────────────────────────────
# DETECCAO — FUNCOES AUXILIARES
# ─────────────────────────────────────────────
def pessoa_horizontal(box, keypoints):
    x1, y1, x2, y2 = box
    largura = x2 - x1
    altura  = y2 - y1
    if altura == 0 or largura == 0:
        return False
    if (altura / largura) < 0.8:
        return True
    if keypoints is not None and len(keypoints) >= 17:
        kp = keypoints
        ombro_y     = None
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
    return (regiao["x1"] <= cx <= regiao["x2"] and
            regiao["y1"] <= cy <= regiao["y2"])

def lado_da_linha(px, py, x1, y1, x2, y2):
    return (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)

def salvar_evento(camera_id, tipo, confianca, nome, rtsp_url=""):
    try:
        resp = requests.post(f"{API_BASE}/eventos/", json={
            "camera_id": camera_id,
            "tipo": tipo,
            "confianca": round(confianca, 2)
        }, timeout=3)

        evento_id = None
        try:
            evento_id = resp.json().get("id")
        except:
            pass

        print(f"[{nome}] {tipo} ({confianca:.0%})", flush=True)

        if evento_id and rtsp_url:
            def _gravar(eid=evento_id, cid=camera_id, rurl=rtsp_url):
                url = gravar_e_fazer_upload_clipe(cid, rurl, str(eid))
                if url:
                    try:
                        requests.patch(f"{API_BASE}/eventos/{eid}", json={
                            "video_url": url
                        }, timeout=5)
                        print(f"[CLIPE] Evento {eid} atualizado com video", flush=True)
                    except Exception as e:
                        print(f"[CLIPE] Erro ao atualizar evento: {e}", flush=True)

            _clipe_pool.submit(_gravar)

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
    linha   = None
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

def buscar_analiticos(camera_id: str) -> dict:
    try:
        supabase = get_supabase()
        res = supabase.table("camera_analiticos").select("*").eq("camera_id", camera_id).execute()
        if res.data:
            return res.data[0]
    except Exception as e:
        print(f"[ANALITICOS] Erro ao buscar {camera_id}: {e}", flush=True)
    # Padrao FALSE — so ativa o que o usuario ligar explicitamente
    return {
        "queda_leito": False, "queda_pe": False, "pessoa": False,
        "banheiro_tempo": False, "gesto_socorro": False,
        "linha_contagem": False, "habitos": False
    }

def iou(boxA, boxB):
    xA    = max(boxA[0], boxB[0])
    yA    = max(boxA[1], boxB[1])
    xB    = min(boxA[2], boxB[2])
    yB    = min(boxA[3], boxB[3])
    inter = max(0, xB - xA) * max(0, yB - yA)
    if inter == 0:
        return 0
    areaA = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
    areaB = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
    return inter / (areaA + areaB - inter)


# ─────────────────────────────────────────────
# LOOP PRINCIPAL POR CAMERA
# ─────────────────────────────────────────────
def processar_camera(camera):
    camera_id  = camera["id"]
    nome       = camera["nome"]
    rtsp_url   = camera["rtsp_url"]
    empresa_id = camera.get("empresa_id", "")

    print(f"[{nome}] Iniciando monitoramento...", flush=True)

    iniciar_captura_continua(camera_id, rtsp_url)

    tracks         = {}
    next_id        = 0
    linha          = None
    regioes        = []
    config_refresh = 0

    heatmap_acc          = defaultdict(float)
    heatmap_ultimo_envio = time.time()

    cooldowns         = defaultdict(lambda: defaultdict(float))
    COOLDOWN_SEGUNDOS = 30

    presenca_regiao      = defaultdict(lambda: defaultdict(dict))
    sono_registrado_hoje = None
    analiticos           = buscar_analiticos(camera_id)

    while True:
        try:
            agora    = time.time()
            agora_dt = datetime.now(timezone.utc)

            if agora - config_refresh > 30:
                linha, regioes = buscar_configuracoes(camera_id)
                analiticos     = buscar_analiticos(camera_id)
                config_refresh = agora

            hoje_str = agora_dt.date().isoformat()
            if sono_registrado_hoje != hoje_str:
                sono_registrado_hoje = None

            if agora - heatmap_ultimo_envio > 60:
                enviar_heatmap(camera_id, dict(heatmap_acc), nome)
                heatmap_acc.clear()
                heatmap_ultimo_envio = agora

            # Le frame do cache da thread de captura continua
            # Evita abrir nova conexao RTSP a cada 2s por camera
            frame = get_frame_atual(camera_id)
            if frame is None:
                print(f"[{nome}] Aguardando frame da captura continua...", flush=True)
                time.sleep(2)
                continue

            h, w    = frame.shape[:2]
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
                    kps    = None
                    if result.keypoints is not None and i < len(result.keypoints.data):
                        kps = result.keypoints.data[i].cpu().numpy()
                    deteccoes.append({"box": coords, "conf": conf, "kps": kps})

            cama     = next((r for r in regioes if r["tipo"] == "cama"),     None)
            banheiro = next((r for r in regioes if r["tipo"] == "banheiro"), None)
            cozinha  = next((r for r in regioes if r["tipo"] == "cozinha"),  None)
            quarto   = next((r for r in regioes if r["tipo"] == "quarto"),   None)

            novos_tracks = {}
            usados       = set()

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
                    hx = round(cx / 0.02) * 0.02
                    hy = round(cy / 0.02) * 0.02
                    heatmap_acc[(hx, hy)] += 1

                    horizontal     = pessoa_horizontal(det["box"], det["kps"])
                    na_cama        = cama     and pessoa_na_regiao(cx, cy, cama)
                    no_banheiro    = banheiro and pessoa_na_regiao(cx, cy, banheiro)
                    na_cozinha     = cozinha  and pessoa_na_regiao(cx, cy, cozinha)
                    no_quarto      = quarto   and pessoa_na_regiao(cx, cy, quarto)
                    estava_na_cama = track.get("na_cama", False)

                    def pode_alertar(tipo):
                        return agora - cooldowns[tid][tipo] > COOLDOWN_SEGUNDOS

                    def analitico_ativo(key):
                        return analiticos.get(key, True)

                    if estava_na_cama and not na_cama and horizontal:
                        if analitico_ativo("queda_leito") and pode_alertar("queda_leito"):
                            salvar_evento(camera_id, "queda_leito", det["conf"], nome, rtsp_url)
                            cooldowns[tid]["queda_leito"] = agora

                    elif not na_cama and horizontal and not estava_na_cama:
                        if analitico_ativo("queda_pe") and pode_alertar("queda_pe"):
                            salvar_evento(camera_id, "queda_pe", det["conf"], nome, rtsp_url)
                            cooldowns[tid]["queda_pe"] = agora

                    if linha:
                        lado_atual = lado_da_linha(cx, cy,
                                                   linha["x1"], linha["y1"],
                                                   linha["x2"], linha["y2"])
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
                        hora_agora = agora_dt.hour
                        if 4 <= hora_agora <= 11:
                            sono_registrado_hoje = hoje_str
                            registrar_habito_sono(camera_id, empresa_id, agora_dt)

                    if no_banheiro:
                        pr = presenca_regiao[tid]["banheiro"]
                        if not pr:
                            presenca_regiao[tid]["banheiro"] = {"inicio": agora_dt, "ultima": agora_dt}
                        else:
                            seg_desde_ultima = (agora_dt - pr["ultima"]).total_seconds()
                            if seg_desde_ultima <= 30:
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
                            seg_desde_ultima = (agora_dt - pr["ultima"]).total_seconds()
                            if seg_desde_ultima <= 30:
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
                        "lado": lado_da_linha(cx, cy,
                                              linha["x1"], linha["y1"],
                                              linha["x2"], linha["y2"]) if linha else None,
                        "na_cama": na_cama,
                        "horizontal": horizontal,
                    }

            for idx, det in enumerate(deteccoes):
                if idx not in usados:
                    cx = (det["box"][0] + det["box"][2]) / 2 / w
                    cy = (det["box"][1] + det["box"][3]) / 2 / h
                    hx = round(cx / 0.02) * 0.02
                    hy = round(cy / 0.02) * 0.02
                    heatmap_acc[(hx, hy)] += 1

                    na_cama  = cama and pessoa_na_regiao(cx, cy, cama)
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


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    print("VMS Worker iniciando...", flush=True)

    while True:
        try:
            resp    = requests.get(f"{API_BASE}/cameras/", timeout=10)
            cameras = [c for c in resp.json() if c.get("ativo")]
            print(f"{len(cameras)} cameras ativas", flush=True)
            break
        except Exception as e:
            print(f"Erro: {e}. Tentando em 5s...", flush=True)
            time.sleep(5)

    threading.Thread(target=thread_verificacao_habitos, daemon=True).start()

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
