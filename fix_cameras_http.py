with open("backend/app/routers/cameras.py", "r", encoding="utf-8") as f:
    content = f.read()

# Adiciona Optional import se nao tiver
if "from typing import Optional" not in content:
    content = content.replace("from pydantic import BaseModel", "from pydantic import BaseModel\nfrom typing import Optional")

# Atualiza CameraCreate
old = """class CameraCreate(BaseModel):
    nome: str
    rtsp_url: str
    empresa_id: UUID"""

new = """class CameraCreate(BaseModel):
    nome: str
    rtsp_url: str
    http_url: Optional[str] = None
    empresa_id: UUID"""

content = content.replace(old, new)

# Atualiza CameraResponse
old2 = """class CameraResponse(BaseModel):
    id: UUID
    nome: str
    rtsp_url: str
    ativo: bool
    empresa_id: UUID"""

new2 = """class CameraResponse(BaseModel):
    id: UUID
    nome: str
    rtsp_url: str
    http_url: Optional[str] = None
    ativo: bool
    empresa_id: UUID"""

content = content.replace(old2, new2)

# Atualiza criar_camera
old3 = """    nova = Camera(
        id=uuid.uuid4(),
        nome=camera.nome,
        rtsp_url=camera.rtsp_url,
        empresa_id=camera.empresa_id,
    )"""

new3 = """    nova = Camera(
        id=uuid.uuid4(),
        nome=camera.nome,
        rtsp_url=camera.rtsp_url,
        http_url=camera.http_url,
        empresa_id=camera.empresa_id,
    )"""

content = content.replace(old3, new3)

with open("backend/app/routers/cameras.py", "w", encoding="utf-8") as f:
    f.write(content)

print("OK - http_url adicionado")
