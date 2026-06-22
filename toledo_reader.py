"""
VMS Platform - Leitor Serial Toledo
Roda no PC do caixa, le peso+valor da balanca e envia para o backend.

Instalacao:
  pip install pyserial requests

Uso:
  python toledo_reader.py --port COM3 --empresa_id SEU_ID --camera_id CAM_ID

Portas comuns:
  Windows: COM1, COM2, COM3...
  Linux: /dev/ttyUSB0, /dev/ttyS0...
"""

import serial
import time
import requests
import argparse
import re
import sys

API_BASE = "https://vms-platform-production.up.railway.app"

# Protocolo Toledo padrao:
# Resposta tipica: "  0.250 kg   R$  3.75\r\n"
# Ou formato compacto: "P=0.250 V=3.75\r\n"
PESO_REGEX   = re.compile(r'(\d+[.,]\d+)\s*kg', re.IGNORECASE)
VALOR_REGEX  = re.compile(r'R\$\s*(\d+[.,]\d+)', re.IGNORECASE)
VALOR_REGEX2 = re.compile(r'V=(\d+[.,]\d+)', re.IGNORECASE)


def parsear_toledo(linha: str):
    """
    Tenta extrair peso e valor de uma linha serial da Toledo.
    Retorna (peso_gramas, valor) ou (None, None) se nao reconheceu.
    """
    linha = linha.strip()
    if not linha:
        return None, None

    peso  = None
    valor = None

    m = PESO_REGEX.search(linha)
    if m:
        peso = float(m.group(1).replace(',', '.')) * 1000  # kg -> gramas

    m = VALOR_REGEX.search(linha) or VALOR_REGEX2.search(linha)
    if m:
        valor = float(m.group(1).replace(',', '.'))

    return peso, valor


def enviar_leitura(empresa_id: str, camera_id: str, peso: float, valor: float):
    """Envia leitura para o backend VMS."""
    try:
        resp = requests.post(f"{API_BASE}/caixa/leitura", json={
            "empresa_id": empresa_id,
            "camera_id": camera_id,
            "peso_gramas": round(peso, 2),
            "valor_balanca": round(valor, 2),
        }, timeout=5)
        if resp.status_code == 200:
            print(f"[TOLEDO] Enviado: {peso:.0f}g = R${valor:.2f}", flush=True)
        else:
            print(f"[TOLEDO] Erro backend: {resp.status_code}", flush=True)
    except Exception as e:
        print(f"[TOLEDO] Erro conexao: {e}", flush=True)


def loop_leitura(port: str, empresa_id: str, camera_id: str, baud: int = 9600):
    """
    Loop principal — fica lendo a porta serial e enviando ao backend
    quando detecta uma leitura valida com peso > 0 e valor > 0.
    """
    print(f"[TOLEDO] Conectando em {port} @ {baud} baud...", flush=True)

    ultimo_envio = 0
    ultimo_peso  = None
    COOLDOWN     = 3  # segundos entre envios da mesma leitura

    try:
        ser = serial.Serial(
            port=port,
            baudrate=baud,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=1
        )
        print(f"[TOLEDO] Conectado! Aguardando leituras...", flush=True)

        while True:
            try:
                linha = ser.readline().decode('ascii', errors='ignore')
                if not linha:
                    continue

                peso, valor = parsear_toledo(linha)

                if peso is None or valor is None:
                    continue
                if peso <= 0 or valor <= 0:
                    continue

                agora = time.time()

                # Evita enviar a mesma leitura multiplas vezes
                peso_mudou = ultimo_peso is None or abs(peso - ultimo_peso) > 5
                cooldown_ok = agora - ultimo_envio > COOLDOWN

                if peso_mudou and cooldown_ok:
                    enviar_leitura(empresa_id, camera_id, peso, valor)
                    ultimo_envio = agora
                    ultimo_peso  = peso

            except serial.SerialException as e:
                print(f"[TOLEDO] Erro serial: {e}. Reconectando em 5s...", flush=True)
                time.sleep(5)
                break

    except serial.SerialException as e:
        print(f"[TOLEDO] Nao foi possivel abrir {port}: {e}", flush=True)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Leitor serial Toledo para VMS Platform")
    parser.add_argument("--port",       required=True, help="Porta serial (ex: COM3 ou /dev/ttyUSB0)")
    parser.add_argument("--empresa_id", required=True, help="ID da empresa no VMS")
    parser.add_argument("--camera_id",  required=True, help="ID da camera do caixa")
    parser.add_argument("--baud",       type=int, default=9600, help="Baud rate (padrao: 9600)")
    args = parser.parse_args()

    print("VMS Platform - Leitor Toledo iniciando...", flush=True)
    print(f"Empresa: {args.empresa_id}", flush=True)
    print(f"Camera:  {args.camera_id}", flush=True)

    # Loop com reconexao automatica
    while True:
        loop_leitura(args.port, args.empresa_id, args.camera_id, args.baud)
        print("[TOLEDO] Reconectando em 5s...", flush=True)
        time.sleep(5)


if __name__ == "__main__":
    main()
