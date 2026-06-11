with open("backend/app/routers/cameras.py", "r", encoding="utf-8") as f:
    content = f.read()

old = """async def _gerar_mjpeg_async(rtsp_url: str):
    \"\"\"Async generator que produz frames MJPEG via asyncio subprocess.\"\"\"
    import asyncio
    SOI = b"\\xff\\xd8"
    EOI = b"\\xff\\xd9"

    while True:
        proc = None
        try:
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg",
                "-rtsp_transport", "tcp",
                "-i", rtsp_url,
                "-vf", "fps=15,scale=1280:-1",
                "-q:v", "5",
                "-f", "image2pipe",
                "-vcodec", "mjpeg",
                "pipe:1",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL
            )

            buffer = b""
            while True:
                chunk = await proc.stdout.read(16384)
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
                    frame = buffer[start:end + 2]
                    buffer = buffer[end + 2:]

                    if len(frame) > 1000:
                        yield (
                            b"--frame\\r\\n"
                            b"Content-Type: image/jpeg\\r\\n"
                            b"Content-Length: " + str(len(frame)).encode() + b"\\r\\n\\r\\n" +
                            frame + b"\\r\\n"
                        )

        except Exception as e:
            print(f"[MJPEG] Erro: {e}", flush=True)
        finally:
            if proc:
                try:
                    proc.terminate()
                except:
                    pass
        await asyncio.sleep(2)"""

new = """def _gerar_mjpeg_sync(rtsp_url: str, queue):
    \"\"\"Thread que captura frames MJPEG e coloca na queue.\"\"\"
    import subprocess as sp
    SOI = b"\\xff\\xd8"
    EOI = b"\\xff\\xd9"

    while not queue.get_nowait() if not queue.empty() else False:
        proc = None
        try:
            proc = sp.Popen([
                "ffmpeg", "-rtsp_transport", "tcp",
                "-i", rtsp_url,
                "-vf", "fps=10,scale=1280:-1",
                "-q:v", "5",
                "-f", "image2pipe",
                "-vcodec", "mjpeg",
                "pipe:1"
            ], stdout=sp.PIPE, stderr=sp.DEVNULL)

            buffer = b""
            while True:
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
                    frame = buffer[start:end + 2]
                    buffer = buffer[end + 2:]
                    if len(frame) > 1000:
                        queue.put(frame)
        except Exception as e:
            print(f"[MJPEG] Erro: {e}", flush=True)
        finally:
            if proc:
                try: proc.terminate()
                except: pass
        time.sleep(2)

async def _gerar_mjpeg_async(rtsp_url: str):
    \"\"\"Async generator que serve frames MJPEG via thread worker.\"\"\"
    import asyncio
    import queue as qmodule
    import threading

    q = qmodule.Queue(maxsize=30)
    stop = qmodule.Queue()

    t = threading.Thread(target=_gerar_mjpeg_sync, args=(rtsp_url, q), daemon=True)
    t.start()

    try:
        while True:
            try:
                frame = await asyncio.get_event_loop().run_in_executor(None, lambda: q.get(timeout=5))
                yield (
                    b"--frame\\r\\n"
                    b"Content-Type: image/jpeg\\r\\n"
                    b"Content-Length: " + str(len(frame)).encode() + b"\\r\\n\\r\\n" +
                    frame + b"\\r\\n"
                )
            except Exception:
                break
    finally:
        stop.put(True)"""

if old in content:
    content = content.replace(old, new)
    with open("backend/app/routers/cameras.py", "w", encoding="utf-8") as f:
        f.write(content)
    print("OK")
else:
    print("ERRO - trecho nao encontrado")
