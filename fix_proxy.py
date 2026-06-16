with open("backend/app/routers/cameras.py", "r", encoding="utf-8") as f:
    content = f.read()

old = """@router.get("/{camera_id}/live")
def live_frame(camera_id: UUID):
    \"\"\"Serve o frame mais recente capturado pelo worker (sem abrir RTSP).\"\"\"
    live_path = f"/tmp/live_{camera_id}.jpg"
    if os.path.exists(live_path):
        return Response(
            content=open(live_path, "rb").read(),
            media_type="image/jpeg",
            headers={"Cache-Control": "no-cache", "X-From-Worker": "true"}
        )
    raise HTTPException(status_code=503, detail="Frame nao disponivel ainda")"""

new = """@router.get("/{camera_id}/live")
def live_frame(camera_id: UUID, db: Session = Depends(get_db)):
    \"\"\"Serve frame ao vivo - tenta http_url da camera, senão usa worker.\"\"\"
    import requests as req

    # Tenta buscar direto da câmera via http_url
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if camera and camera.http_url:
        try:
            r = req.get(camera.http_url, timeout=3, verify=False)
            if r.status_code == 200 and len(r.content) > 1000:
                return Response(
                    content=r.content,
                    media_type="image/jpeg",
                    headers={"Cache-Control": "no-cache", "X-Source": "http"}
                )
        except:
            pass

    # Fallback: usa frame do worker
    live_path = f"/tmp/live_{camera_id}.jpg"
    if os.path.exists(live_path):
        return Response(
            content=open(live_path, "rb").read(),
            media_type="image/jpeg",
            headers={"Cache-Control": "no-cache", "X-Source": "worker"}
        )
    raise HTTPException(status_code=503, detail="Frame nao disponivel ainda")"""

if old in content:
    content = content.replace(old, new)
    print("OK proxy")
else:
    print("ERRO - adicionando rota nova")
    # Adiciona antes do snapshot
    content = content.replace(
        '@router.get("/{camera_id}/snapshot")',
        '''@router.get("/{camera_id}/live")
def live_frame(camera_id: UUID, db: Session = Depends(get_db)):
    import requests as req
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if camera and camera.http_url:
        try:
            r = req.get(camera.http_url, timeout=3, verify=False)
            if r.status_code == 200 and len(r.content) > 1000:
                return Response(content=r.content, media_type="image/jpeg",
                               headers={"Cache-Control": "no-cache"})
        except:
            pass
    live_path = f"/tmp/live_{camera_id}.jpg"
    if os.path.exists(live_path):
        return Response(content=open(live_path, "rb").read(), media_type="image/jpeg",
                       headers={"Cache-Control": "no-cache"})
    raise HTTPException(status_code=503, detail="Frame nao disponivel ainda")

@router.get("/{camera_id}/snapshot")'''
    )
    print("OK adicionou rota nova")

with open("backend/app/routers/cameras.py", "w", encoding="utf-8") as f:
    f.write(content)
