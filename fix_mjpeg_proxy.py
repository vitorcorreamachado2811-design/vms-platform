with open("backend/app/routers/cameras.py", "r", encoding="utf-8") as f:
    content = f.read()

# Adiciona rota MJPEG proxy antes do snapshot
old = '@router.get("/{camera_id}/snapshot")'

new = '''@router.get("/{camera_id}/stream/mjpeg")
async def mjpeg_proxy(camera_id: UUID, db: Session = Depends(get_db)):
    """Proxy MJPEG - conecta na camera HTTP e repassa stream direto."""
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera or not camera.http_url:
        raise HTTPException(status_code=404, detail="Camera sem HTTP URL")

    import urllib.request, base64, urllib.parse, asyncio

    parsed = urllib.parse.urlparse(camera.http_url)
    # Monta URL de stream MJPEG da Intelbras
    stream_url = f"http://{parsed.hostname}:{parsed.port}/cgi-bin/mjpg/video.cgi?channel=1&subtype=0"
    creds = None
    if parsed.username:
        creds = base64.b64encode(f"{parsed.username}:{parsed.password}".encode()).decode()

    def generate():
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
            print(f"[MJPEG PROXY] Erro: {e}", flush=True)

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=myboundary",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"}
    )

@router.get("/{camera_id}/snapshot")'''

if old in content:
    content = content.replace(old, new)
    # Adiciona StreamingResponse ao import
    content = content.replace(
        "from fastapi.responses import FileResponse, Response",
        "from fastapi.responses import FileResponse, Response, StreamingResponse"
    )
    print("OK MJPEG proxy")
else:
    print("ERRO")

with open("backend/app/routers/cameras.py", "w", encoding="utf-8") as f:
    f.write(content)
