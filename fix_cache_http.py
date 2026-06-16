with open("backend/app/routers/cameras.py", "r", encoding="utf-8") as f:
    content = f.read()

# Adiciona cache de frames HTTP logo após os imports
old = "processos_ffmpeg: dict[str, subprocess.Popen] = {}"

new = """processos_ffmpeg: dict[str, subprocess.Popen] = {}

# Cache de frames HTTP por camera: {camera_id: {"data": bytes, "ts": float}}
_http_cache: dict = {}
_http_cache_lock = __import__("threading").Lock()

def _worker_http_cache(camera_id: str, http_url: str):
    import urllib.request, base64, urllib.parse, threading, time
    parsed = urllib.parse.urlparse(http_url)
    clean_url = http_url
    creds = None
    if parsed.username:
        creds = base64.b64encode(f"{parsed.username}:{parsed.password}".encode()).decode()
        clean_url = http_url.replace(f"{parsed.username}:{parsed.password}@", "")

    print(f"[HTTP CACHE] Worker iniciado para {camera_id}", flush=True)
    while _http_cache.get(camera_id, {}).get("ativo"):
        try:
            req2 = urllib.request.Request(clean_url)
            if creds:
                req2.add_header("Authorization", "Basic " + creds)
            r2 = urllib.request.urlopen(req2, timeout=3)
            data = r2.read()
            if len(data) > 1000:
                with _http_cache_lock:
                    _http_cache[camera_id]["data"] = data
                    _http_cache[camera_id]["ts"] = time.time()
        except Exception as e:
            pass
        time.sleep(0.2)  # 5fps
    print(f"[HTTP CACHE] Worker encerrado para {camera_id}", flush=True)

def iniciar_http_cache(camera_id: str, http_url: str):
    import threading
    with _http_cache_lock:
        if _http_cache.get(camera_id, {}).get("ativo"):
            return
        _http_cache[camera_id] = {"ativo": True, "data": None, "ts": 0}
    t = threading.Thread(target=_worker_http_cache, args=(camera_id, http_url), daemon=True)
    t.start()"""

if old in content:
    content = content.replace(old, new)
    print("OK cache worker")
else:
    print("ERRO cache worker")

# Atualiza listar_cameras para iniciar cache
old2 = """@router.get("/", response_model=list[CameraResponse])
def listar_cameras(db: Session = Depends(get_db)):
    return db.query(Camera).all()"""

new2 = """@router.get("/", response_model=list[CameraResponse])
def listar_cameras(db: Session = Depends(get_db)):
    cameras = db.query(Camera).all()
    for c in cameras:
        if c.ativo and c.http_url:
            iniciar_http_cache(str(c.id), c.http_url)
    return cameras"""

content = content.replace(old2, new2)

# Atualiza live_frame para usar cache
old3 = """    if camera and camera.http_url:
        try:
            import urllib.request, base64, urllib.parse
            parsed = urllib.parse.urlparse(camera.http_url)
            clean_url = camera.http_url
            creds = None
            if parsed.username:
                creds = base64.b64encode(f"{parsed.username}:{parsed.password}".encode()).decode()
                clean_url = camera.http_url.replace(f"{parsed.username}:{parsed.password}@", "")
            req2 = urllib.request.Request(clean_url)
            if creds:
                req2.add_header("Authorization", "Basic " + creds)
            r2 = urllib.request.urlopen(req2, timeout=3)
            data = r2.read()
            if len(data) > 1000:
                return Response(
                    content=data,
                    media_type="image/jpeg",
                    headers={"Cache-Control": "no-cache", "X-Source": "http"}
                )
        except:
            pass"""

new3 = """    if camera and camera.http_url:
        # Inicia cache se nao estiver rodando
        iniciar_http_cache(str(camera_id), camera.http_url)
        # Serve do cache (resposta instantanea)
        with _http_cache_lock:
            cached = _http_cache.get(str(camera_id), {})
            data = cached.get("data")
        if data:
            return Response(
                content=data,
                media_type="image/jpeg",
                headers={"Cache-Control": "no-cache", "X-Source": "http-cache"}
            )"""

if old3 in content:
    content = content.replace(old3, new3)
    print("OK live_frame cache")
else:
    print("ERRO live_frame")

with open("backend/app/routers/cameras.py", "w", encoding="utf-8") as f:
    f.write(content)
