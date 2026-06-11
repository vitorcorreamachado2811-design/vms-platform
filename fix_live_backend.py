with open("backend/app/routers/cameras.py", "r", encoding="utf-8") as f:
    content = f.read()

old = """@router.get("/{camera_id}/snapshot")"""

new = """@router.get("/{camera_id}/live")
def live_frame(camera_id: UUID):
    \"\"\"Serve o frame mais recente capturado pelo worker (sem abrir RTSP).\"\"\"
    live_path = f"/tmp/live_{camera_id}.jpg"
    if os.path.exists(live_path):
        return Response(
            content=open(live_path, "rb").read(),
            media_type="image/jpeg",
            headers={"Cache-Control": "no-cache", "X-From-Worker": "true"}
        )
    raise HTTPException(status_code=503, detail="Frame nao disponivel ainda")

@router.get("/{camera_id}/snapshot")"""

if old in content:
    content = content.replace(old, new)
    with open("backend/app/routers/cameras.py", "w", encoding="utf-8") as f:
        f.write(content)
    print("OK backend")
else:
    print("ERRO backend")
