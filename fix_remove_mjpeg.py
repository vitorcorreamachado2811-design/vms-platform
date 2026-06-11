with open("backend/app/routers/cameras.py", "r", encoding="utf-8") as f:
    content = f.read()

# Remove tudo relacionado ao MJPEG
import re
content = re.sub(r'\ndef _gerar_mjpeg_sync.*?(?=\n@router)', '', content, flags=re.DOTALL)
content = re.sub(r'\nasync def _gerar_mjpeg_async.*?(?=\n@router)', '', content, flags=re.DOTALL)
content = re.sub(r"\n@router\.get\(\"/{camera_id}/stream/mjpeg\"\).*?(?=\n@router)", '', content, flags=re.DOTALL)

# Remove StreamingResponse do import
content = content.replace("from fastapi.responses import FileResponse, Response, StreamingResponse", 
                          "from fastapi.responses import FileResponse, Response")

with open("backend/app/routers/cameras.py", "w", encoding="utf-8") as f:
    f.write(content)
print("OK - MJPEG removido")
