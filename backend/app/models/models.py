from sqlalchemy import Column, String, Boolean, Float, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base
import uuid
from datetime import datetime, UTC

class Empresa(Base):
    __tablename__ = "empresas"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nome = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    ativo = Column(Boolean, default=True)
    cameras = relationship("Camera", back_populates="empresa")
    usuarios = relationship("Usuario", back_populates="empresa")

class Usuario(Base):
    __tablename__ = "usuarios"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    empresa_id = Column(UUID(as_uuid=True), ForeignKey("empresas.id"))
    nome = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    senha_hash = Column(String, nullable=False)
    ativo = Column(Boolean, default=True)
    perfil = Column(String, default='familiar')
    empresa = relationship("Empresa", back_populates="usuarios")

class Camera(Base):
    __tablename__ = "cameras"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    empresa_id = Column(UUID(as_uuid=True), ForeignKey("empresas.id"))
    nome = Column(String, nullable=False)
    rtsp_url = Column(String, nullable=False)
    http_url = Column(String, nullable=True)
    ativo = Column(Boolean, default=True)
    criado_em = Column(DateTime, default=lambda: datetime.now(UTC))
    empresa = relationship("Empresa", back_populates="cameras")
    eventos = relationship("Evento", back_populates="camera")

class Evento(Base):
    __tablename__ = "eventos"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    camera_id = Column(UUID(as_uuid=True), ForeignKey("cameras.id"))
    tipo = Column(String, nullable=False)
    confianca = Column(Float, nullable=False)
    criado_em = Column(DateTime, default=lambda: datetime.now(UTC))
    video_url = Column(String, nullable=True)
    camera = relationship("Camera", back_populates="eventos")

class LinhaContagem(Base):
    __tablename__ = "linhas_contagem"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    camera_id = Column(UUID(as_uuid=True), ForeignKey("cameras.id"), unique=True)
    x1 = Column(Float); y1 = Column(Float); x2 = Column(Float); y2 = Column(Float)

class Regiao(Base):
    __tablename__ = "regioes"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    camera_id = Column(UUID(as_uuid=True), ForeignKey("cameras.id"))
    tipo = Column(String, nullable=False)
    x1 = Column(Float); y1 = Column(Float); x2 = Column(Float); y2 = Column(Float)
    tempo_alerta_min = Column(Integer, default=30)

class HeatmapPonto(Base):
    __tablename__ = "heatmap_pontos"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    camera_id = Column(UUID(as_uuid=True), ForeignKey("cameras.id"))
    x = Column(Float); y = Column(Float); peso = Column(Float, default=1.0)
    criado_em = Column(DateTime, default=lambda: datetime.now(UTC))

class HabitoRegistro(Base):
    __tablename__ = "habitos_registros"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    camera_id = Column(UUID(as_uuid=True), ForeignKey("cameras.id"))
    empresa_id = Column(UUID(as_uuid=True), ForeignKey("empresas.id"))
    tipo = Column(String, nullable=False)
    horario_evento = Column(DateTime, nullable=False)
    duracao_minutos = Column(Integer, nullable=True)
    meta = Column(Text, nullable=True)

class HabitoPerfil(Base):
    __tablename__ = "habitos_perfil"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    camera_id = Column(UUID(as_uuid=True), ForeignKey("cameras.id"))
    empresa_id = Column(UUID(as_uuid=True), ForeignKey("empresas.id"))
    pessoa_id = Column(String, default='default')
    tipo = Column(String, nullable=False)
    hora_media = Column(Float)
    desvio_padrao = Column(Float)
    threshold_alerta = Column(Float)
    amostras_count = Column(Integer, default=0)
    aprendizado_completo = Column(Boolean, default=False)
    ultima_atualizacao = Column(DateTime)

class HabitoAlerta(Base):
    __tablename__ = "habitos_alertas"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    camera_id = Column(UUID(as_uuid=True), ForeignKey("cameras.id"))
    empresa_id = Column(UUID(as_uuid=True), ForeignKey("empresas.id"))
    pessoa_id = Column(String, default='default')
    tipo = Column(String, nullable=False)
    horario_esperado = Column(String)
    horario_real = Column(String, nullable=True)
    desvio_minutos = Column(Integer)
    status = Column(String, default='pendente')
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))

# Aliases para compatibilidade com routers existentes
RegiaoMonitorada = Regiao