with open("backend/app/routers/cameras.py", "r", encoding="utf-8") as f:
    content = f.read()

old = '''    # Monta URL de snapshot da Intelbras
    snapshot_url = f"http://{parsed.hostname}:{parsed.port}/cgi-bin/snapshot.cgi?channel=1"

    def generate():
        import time
        while True:
            try:
                req2 = urllib.request.Request(snapshot_url)
                if creds:
                    req2.add_header("Authorization", "Basic " + creds)
                r2 = urllib.request.urlopen(req2, timeout=3)
                frame = r2.read()
                if len(frame) > 1000:
                    yield (
                        b"--myboundary\\r\\n"
                        b"Content-Type: image/jpeg\\r\\n"
                        b"Content-Length: " + str(len(frame)).encode() + b"\\r\\n\\r\\n" +
                        frame + b"\\r\\n"
                    )
            except Exception as e:
                print(f"[MJPEG PROXY] Erro: {e}", flush=True)
                time.sleep(1)'''

new = '''    snapshot_url = f"http://{parsed.hostname}:{parsed.port}/cgi-bin/snapshot.cgi?channel=1"
    import queue, threading, time

    frame_queue = queue.Queue(maxsize=3)

    def fetch_frames():
        while True:
            try:
                req2 = urllib.request.Request(snapshot_url)
                if creds:
                    req2.add_header("Authorization", "Basic " + creds)
                r2 = urllib.request.urlopen(req2, timeout=3)
                frame = r2.read()
                if len(frame) > 1000:
                    if frame_queue.full():
                        try: frame_queue.get_nowait()
                        except: pass
                    frame_queue.put(frame)
            except Exception as e:
                time.sleep(0.5)

    # Inicia 3 threads paralelas para buscar frames
    for _ in range(3):
        threading.Thread(target=fetch_frames, daemon=True).start()

    def generate():
        while True:
            try:
                frame = frame_queue.get(timeout=5)
                yield (
                    b"--myboundary\\r\\n"
                    b"Content-Type: image/jpeg\\r\\n"
                    b"Content-Length: " + str(len(frame)).encode() + b"\\r\\n\\r\\n" +
                    frame + b"\\r\\n"
                )
            except:
                break'''

if old in content:
    content = content.replace(old, new)
    print("OK threaded MJPEG")
else:
    print("ERRO")

with open("backend/app/routers/cameras.py", "w", encoding="utf-8") as f:
    f.write(content)
