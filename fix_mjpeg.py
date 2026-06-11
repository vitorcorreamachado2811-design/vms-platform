with open("backend/app/routers/cameras.py", "r", encoding="utf-8") as f:
    content = f.read()

old = "    return StreamingResponse(\n        _gerar_mjpeg_async(camera.rtsp_url),"
new = "    async def generate():\n        async for chunk in _gerar_mjpeg_async(camera.rtsp_url):\n            yield chunk\n    return StreamingResponse(\n        generate(),"

if old in content:
    content = content.replace(old, new)
    with open("backend/app/routers/cameras.py", "w", encoding="utf-8") as f:
        f.write(content)
    print("OK")
else:
    print("ERRO - trecho nao encontrado")
