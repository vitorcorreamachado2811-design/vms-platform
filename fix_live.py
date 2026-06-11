with open("worker.py", "r", encoding="utf-8") as f:
    content = f.read()

# Adiciona salvamento do frame live no buffer
old = """def adicionar_frame_buffer(camera_id: str, frame):
    \"\"\"Salva frame como JPEG em disco e guarda so o caminho no buffer.\"\"\"
    buf = get_buffer(camera_id)
    # Remove arquivo mais antigo ANTES de adicionar novo
    if len(buf) == buf.maxlen:
        try:
            old_path = buf[0]
            os.remove(old_path)
        except:
            pass
    # Salva frame como JPEG temporario
    path = f"/tmp/buf_{camera_id}_{int(time.time()*1000)}.jpg"
    try:
        cv2.imwrite(path, frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        buf.append(path)
    except Exception as e:
        print(f"[BUFFER] Erro ao salvar frame: {e}", flush=True)"""

new = """def adicionar_frame_buffer(camera_id: str, frame):
    \"\"\"Salva frame como JPEG em disco e guarda so o caminho no buffer.\"\"\"
    buf = get_buffer(camera_id)
    # Remove arquivo mais antigo ANTES de adicionar novo
    if len(buf) == buf.maxlen:
        try:
            old_path = buf[0]
            os.remove(old_path)
        except:
            pass
    # Salva frame como JPEG temporario
    path = f"/tmp/buf_{camera_id}_{int(time.time()*1000)}.jpg"
    try:
        cv2.imwrite(path, frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        buf.append(path)
    except Exception as e:
        print(f"[BUFFER] Erro ao salvar frame: {e}", flush=True)
        return
    # Salva copia como frame live (usado pelo backend para ao vivo)
    try:
        live_path = f"/tmp/live_{camera_id}.jpg"
        cv2.imwrite(live_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    except:
        pass"""

if old in content:
    content = content.replace(old, new)
    with open("worker.py", "w", encoding="utf-8") as f:
        f.write(content)
    print("OK worker")
else:
    print("ERRO worker")
