from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.routers import cameras, empresas, auth, eventos

Base.metadata.create_all(bind=engine)

app = FastAPI(title="VMS Platform API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(empresas.router, prefix="/empresas", tags=["Empresas"])
app.include_router(cameras.router, prefix="/cameras", tags=["Câmeras"])
app.include_router(auth.router, prefix="/auth", tags=["Autenticação"])
app.include_router(eventos.router, prefix="/eventos", tags=["Eventos"])

@app.get("/")
def root():
    return {"status": "ok", "sistema": "VMS Platform"}