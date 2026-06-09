import requests
import threading
import time
import numpy as np
import math
import os
from collections import defaultdict
from datetime import datetime, timezone
from ultralytics import YOLO
from supabase import create_client

API_BASE = "https://vms-platform-production.up.railway.app"

# Supabase — usado pelo módulo de hábitos
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
# CONFIGURAÇÕES DE HÁBITOS
# ─────────────────────────────────────────────
MIN_AMOSTRAS             = 3      # dias mínimos para ativar alertas
THRESHOLD_MULTIPLIER     = 1.5    # média + 1.5 × desvio
TOLERANCIA_MINIMA_MIN    = 15     # tolerância mínima em minutos
BANHO_DURACAO_MIN        = 5      # minutos contínuos no banheiro = banho
COZINHA_DURACAO_MIN      = 10     # minutos contínuos na cozinha = refeição


# ─────────────────────────────────────────────
# SUPABASE CLIENT
# ─────────────────────────────────────────────
def get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ─────────────────────────────────────────────
# MÓDULO DE HÁBITOS
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
    """Atualiza média/desvio e gera alerta se desviar do padrão."""
    try:
        supabase = get_supabase()

        # Busca últimos 30 registros desse hábito
        registros = supabase.table("habitos_registros").select(
            "metadata"
        ).eq("camera_id", camera_id).eq("tipo", tipo).order(
            "horario_evento", desc=True
        ).limit(30).execute()

        horas = []
        for r in registros.data or []:
            meta = r.get("metadata") or {}
            h = meta.get("hora_decimal")
            if h is not None:
                horas.append(float(h))

        n = len(horas)
        if n == 0:
            return

        media = sum(horas) / n
        desvio = math.sqrt(sum((h - media) ** 2 for h in horas) / max(n - 1, 1)) if n > 1 else 0.0
        threshold = media + max(THRESHOLD_MULTIPLIER * desvio, TOLERANCIA_MINIMA_MIN / 60.0)
        aprendizado_completo = n >= MIN_AMOSTRAS

        # Upsert no perfil
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
            f"[HABITOS] {tipo} | média={_decimal_para_hora(media)} "
            f"desvio=±{desvio*60:.0f}min threshold={_decimal_para_hora(threshold)} "
            f"amostras={n}",
            flush=True
        )

        # Só alerta se aprendizado completo E hora atual passou do threshold
        if not aprendizado_completo or hora_atual <= threshold:
            return

        desvio_minutos = int((hora_atual - media) * 60)
        hoje = horario_evento.date().isoformat()

        # Evita alerta duplicado no mesmo dia
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
            f"[HABITOS] ⚠️ ALERTA {tipo} | esperado até {_decimal_para_hora(threshold)} "
            f"| ocorreu {_decimal_para_hora(hora_atual)} | atraso {desvio_minutos}min",
            flush=True
        )

    except Exception as e:
        print(f"[HABITOS] Erro _atualizar_perfil: {e}", flush=True)


def registrar_habito_sono(camera_id, empresa_id, horario):
    """
    Registra horário de acordar.
    Chamado quando detecta PRIMEIRA pessoa no quarto entre 4h-11h.
    """
    hora_decimal = horario.hour + horario.minute / 60.0
    if not (4 <= hora_decimal <= 11):
        return
    try:
        supabase = get_supabase()
        hoje = horario.date().isoformat()

        # Só registra uma vez por dia
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

        print(f"[HABITOS] 🌙 Sono registrado: {horario.strftime('%H:%M')}", flush=True)
        _atualizar_perfil_e_alertar(camera_id, empresa_id, "sono", hora_decimal, horario)

    except Exception as e:
        print(f"[HABITOS] Erro sono: {e}", flush=True)


def registrar_habito_banho(camera_id, empresa_id, horario_inicio, duracao_minutos):
    """
    Registra banho detectado.
    Chamado quando presença contínua no banheiro >= BANHO_DURACAO_MIN minutos.
    """
    if duracao_minutos < BANHO_DURACAO_MIN:
        return
    hora_decimal = horario_inicio.hour + horario_inicio.minute / 60.0
    try:
        supabase = get_supabase()
        hoje = horario_inicio.date().isoformat()

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

        print(f"[HABITOS] 🚿 Banho registrado: {horario_inicio.strftime('%H:%M')} por {duracao_minutos}min", flush=True)
        _atualizar_perfil_e_alertar(camera_id, empresa_id, "banho", hora_decimal, horario_inicio)

    except Exception as e:
        print(f"[HABITOS] Erro banho: {e}", flush=True)


def registrar_habito_refeicao(camera_id, empresa_id, horario, duracao_minutos):
    """
    Registra refeição detectada na cozinha.
    Chamado quando presença contínua na cozinha >= COZINHA_DURACAO_MIN minutos.
    """
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

        print(f"[HABITOS] 🍽️ Refeição registrada: {horario.strftime('%H:%M')} por {duracao_minutos}min", flush=True)
        _atualizar_perfil_e_alertar(camera_id, empresa_id, "refeicao", hora_decimal, horario)

    except Exception as e:
        print(f"[HABITOS] Erro refeição: {e}", flush=True)


def verificar_habitos_ausentes():
    """
    Verifica se algum hábito esperado NÃO ocorreu no horário.
    Ex: deveria acordar até 7:30 mas são 9h sem detecção.
    Roda a cada 5 minutos via thread separada.
    """
    try:
        supabase = get_supabase()
        agora = datetime.now(timezone.utc)
        hora_agora = agora.hour + agora.minute / 60.0
        hoje = agora.date().isoformat()

        perfis = supabase.table("habitos_perfil").select("*").eq(
            "aprendizado_completo", True
        ).execute()

        for perfil in (perfis.data or []):
            tipo        = perfil["tipo"]
            threshold   = perfil["threshold_alerta"]
            camera_id   = perfil["camera_id"]
            empresa_id  = perfil["empresa_id"]

            # Só verifica se já passou do horário limite
            if hora_agora <= threshold:
                continue

            # Verifica se o hábito já ocorreu hoje
            ocorreu = supabase.table("habitos_registros").select("id").eq(
                "camera_id", camera_id
            ).eq("tipo", tipo).gte("horario_evento", f"{hoje}T00:00:00Z").execute()

            if ocorreu.data:
                continue

            # Verifica se já gerou alerta hoje
            alerta_existente = supabase.table("habitos_alertas").select("id").eq(
                "camera_id", camera_id
            ).eq("tipo", tipo).gte("created_at", f"{hoje}T00:00:00Z").execute()

            if alerta_existente.data:
                continue

            # Gera alerta de ausência
            desvio_minutos = int((hora_agora - perfil["hora_media"]) * 60)
            supabase.table("habitos_alertas").insert({
                "camera_id": camera_id,
                "empresa_id": empresa_id,
                "pessoa_id": perfil["pessoa_id"],
                "tipo": tipo,
                "horario_esperado": _decimal_para_time_str(threshold),
                "horario_real": None,  # não ocorreu
                "desvio_minutos": desvio_minutos,
                "status": "pendente"
            }).execute()

            print(
                f"[HABITOS] ⚠️ AUSÊNCIA {tipo} não ocorreu | "
                f"câmera {camera_id} | atraso {desvio_minutos}min",
                flush=True
            )

    except Exception as e:
        print(f"[HABITOS] Erro verificar_ausentes: {e}", flush=True)


def thread_verificacao_habitos():
    """Thread que roda verificar_habitos_ausentes a cada 5 minutos."""
    print("[HABITOS] Thread de verificação iniciada (a cada 5min)", flush=True)
    while True:
        time.sleep(300)  # 5 minutos
        verificar_habitos_ausentes()


# ─────────────────────────────────────────────
# WORKER ORIGINAL (com integrações de hábitos)
# ─────────────────────────────────────────────

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

def pessoa_na_regiao(cx, cy, regiao):
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
    camera_id  = camera["id"]
    nome       = camera["nome"]
    rtsp_url   = camera["rtsp_url"]
    empresa_id = camera.get("empresa_id", "")

    print(f"[{nome}] Iniciando monitoramento...", flush=True)

    tracks = {}
    next_id = 0
    linha = None
    regioes = []
    config_refresh = 0
    heatmap_acc = defaultdict(float)
    heatmap_ultimo_envio = time.time()
    cooldowns = defaultdict(lambda: defaultdict(float))
    COOLDOWN_SEGUNDOS = 30

    # ── Controle de presença contínua por região (para hábitos) ──
    # {track_id: {"banheiro": {"inicio": datetime, "ultima": datetime},
    #             "cozinha":  {"inicio": datetime, "ultima": datetime}}}
    presenca_regiao = defaultdict(lambda: defaultdict(dict))
    # Controle: primeira detecção no quarto por dia (para sono)
    sono_registrado_hoje = None

    while True:
        try:
            agora = time.time()
            agora_dt = datetime.now(timezone.utc)

            # Atualiza configurações a cada 30s
            if agora - config_refresh > 30:
                linha, regioes = buscar_configuracoes(camera_id)
                config_refresh = agora

            # Reseta flag de sono a cada novo dia
            hoje_str = agora_dt.date().isoformat()
            if sono_registrado_hoje != hoje_str:
                sono_registrado_hoje = None  # Reseta para novo dia

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

            # Identifica regiões especiais
            cama      = next((r for r in regioes if r["tipo"] == "cama"), None)
            banheiro  = next((r for r in regioes if r["tipo"] == "banheiro"), None)
            cozinha   = next((r for r in regioes if r["tipo"] == "cozinha"), None)
            quarto    = next((r for r in regioes if r["tipo"] == "quarto"), None)

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

                    hx = round(cx / 0.02) * 0.02
                    hy = round(cy / 0.02) * 0.02
                    heatmap_acc[(hx, hy)] += 1

                    horizontal    = pessoa_horizontal(det["box"], det["kps"])
                    na_cama       = cama     and pessoa_na_regiao(cx, cy, cama)
                    no_banheiro   = banheiro and pessoa_na_regiao(cx, cy, banheiro)
                    na_cozinha    = cozinha  and pessoa_na_regiao(cx, cy, cozinha)
                    no_quarto     = quarto   and pessoa_na_regiao(cx, cy, quarto)
                    estava_na_cama = track.get("na_cama", False)

                    def pode_alertar(tipo):
                        return agora - cooldowns[tid][tipo] > COOLDOWN_SEGUNDOS

                    # ── DETECÇÕES ORIGINAIS ──────────────────────────

                    # Queda do leito
                    if estava_na_cama and not na_cama and horizontal:
                        if pode_alertar("queda_leito"):
                            salvar_evento(camera_id, "queda_leito", det["conf"], nome)
                            cooldowns[tid]["queda_leito"] = agora

                    # Queda em pé
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

                    # Pessoa normal
                    if not horizontal and not na_cama:
                        if pode_alertar("person"):
                            salvar_evento(camera_id, "person", det["conf"], nome)
                            cooldowns[tid]["person"] = agora

                    # ── HÁBITOS: SONO ────────────────────────────────
                    # Primeira detecção no quarto entre 4h-11h = acordou
                    if no_quarto and not horizontal and sono_registrado_hoje != hoje_str:
                        hora_agora = agora_dt.hour
                        if 4 <= hora_agora <= 11:
                            sono_registrado_hoje = hoje_str
                            registrar_habito_sono(camera_id, empresa_id, agora_dt)

                    # ── HÁBITOS: BANHO ───────────────────────────────
                    # Presença contínua no banheiro >= BANHO_DURACAO_MIN minutos
                    if no_banheiro:
                        pr = presenca_regiao[tid]["banheiro"]
                        if not pr:
                            # Primeira vez nessa passagem
                            presenca_regiao[tid]["banheiro"] = {
                                "inicio": agora_dt,
                                "ultima": agora_dt
                            }
                        else:
                            # Verifica se é presença contínua (tolerância 30s)
                            segundos_desde_ultima = (agora_dt - pr["ultima"]).total_seconds()
                            if segundos_desde_ultima <= 30:
                                presenca_regiao[tid]["banheiro"]["ultima"] = agora_dt
                                duracao = (agora_dt - pr["inicio"]).total_seconds() / 60
                                if duracao >= BANHO_DURACAO_MIN and not pr.get("registrado"):
                                    presenca_regiao[tid]["banheiro"]["registrado"] = True
                                    registrar_habito_banho(
                                        camera_id, empresa_id,
                                        pr["inicio"], int(duracao)
                                    )
                            else:
                                # Saiu e voltou — reseta
                                presenca_regiao[tid]["banheiro"] = {
                                    "inicio": agora_dt,
                                    "ultima": agora_dt
                                }
                    else:
                        # Saiu do banheiro — reseta para próxima detecção
                        presenca_regiao[tid]["banheiro"] = {}

                    # ── HÁBITOS: REFEIÇÃO ────────────────────────────
                    # Presença contínua na cozinha >= COZINHA_DURACAO_MIN minutos
                    if na_cozinha:
                        pr = presenca_regiao[tid]["cozinha"]
                        if not pr:
                            presenca_regiao[tid]["cozinha"] = {
                                "inicio": agora_dt,
                                "ultima": agora_dt
                            }
                        else:
                            segundos_desde_ultima = (agora_dt - pr["ultima"]).total_seconds()
                            if segundos_desde_ultima <= 30:
                                presenca_regiao[tid]["cozinha"]["ultima"] = agora_dt
                                duracao = (agora_dt - pr["inicio"]).total_seconds() / 60
                                if duracao >= COZINHA_DURACAO_MIN and not pr.get("registrado"):
                                    presenca_regiao[tid]["cozinha"]["registrado"] = True
                                    registrar_habito_refeicao(
                                        camera_id, empresa_id,
                                        pr["inicio"], int(duracao)
                                    )
                            else:
                                presenca_regiao[tid]["cozinha"] = {
                                    "inicio": agora_dt,
                                    "ultima": agora_dt
                                }
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

            # Novos tracks (sem histórico)
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

    # Thread de verificação proativa de hábitos ausentes (a cada 5 min)
    t_habitos = threading.Thread(target=thread_verificacao_habitos, daemon=True)
    t_habitos.start()

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
