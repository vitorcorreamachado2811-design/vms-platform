with open("backend/app/routers/cameras.py", "r", encoding="utf-8") as f:
    content = f.read()

old = '''    def generate():
        try:
            req2 = urllib.request.Request(stream_url)
            if creds:
                req2.add_header("Authorization", "Basic " + creds)
            r2 = urllib.request.urlopen(req2, timeout=10)
            while True:
                chunk = r2.read(16384)
                if not chunk:
                    break
                yield chunk
        except Exception as e:
            print(f"[MJPEG PROXY] Erro: {e}", flush=True)'''

new = '''    # Monta URL de snapshot da Intelbras
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

if old in content:
    content = content.replace(old, new)
    # Remove stream_url que nao é mais usado
    content = content.replace(
        '    stream_url = f"http://{parsed.hostname}:{parsed.port}/cgi-bin/mjpg/video.cgi?channel=1&subtype=0"\n',
        ''
    )
    print("OK MJPEG snapshot loop")
else:
    print("ERRO")

with open("backend/app/routers/cameras.py", "w", encoding="utf-8") as f:
    f.write(content)
