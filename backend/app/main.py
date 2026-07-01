from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.routers import cameras, empresas, auth, eventos, contagem, heatmap, regioes
from app.routers import habitos
from app.routers import vendas
from app.routers import freezer
from app.routers import caixa
from app.routers import mediamtx_webhook

Base.metadata.create_all(bind=engine)

app = FastAPI(title="VMS Platform API", version="1.0.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(empresas.router, prefix="/empresas", tags=["Empresas"])
app.include_router(cameras.router, prefix="/cameras", tags=["Cameras"])
app.include_router(auth.router, prefix="/auth", tags=["Autenticacao"])
app.include_router(eventos.router, prefix="/eventos", tags=["Eventos"])
app.include_router(contagem.router, prefix="/contagem", tags=["Contagem"])
app.include_router(heatmap.router, prefix="/heatmap", tags=["Heatmap"])
app.include_router(regioes.router, prefix="/regioes", tags=["Regioes"])
app.include_router(caixa.router, prefix="/caixa", tags=["Caixa"])
app.include_router(freezer.router, prefix="/freezer", tags=["Freezer"])
app.include_router(vendas.router, prefix="/vendas", tags=["Vendas"])
app.include_router(habitos.router, prefix="/habitos", tags=["Habitos"])
app.include_router(mediamtx_webhook.router, prefix="/mediamtx", tags=["MediaMTX"])

@app.get("/")
def root():
    return {"status": "ok", "sistema": "VMS Platform"}
