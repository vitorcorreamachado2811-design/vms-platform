from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Float
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime, UTC
import uuid
from app.database import Base

class Empresa(Base):
    __tablename__ = "empresas"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nome = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    ativo = Column(Boolean, default=True)
    criado_em = Column(DateTime, default=lambda: datetime.now(UTC))
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
    empresa = relationship("Empresa", back_populates="usuarios")

class Camera(Base):
    __tablename__ = "cameras"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    empresa_id = Column(UUID(as_uuid=True), ForeignKey("empresas.id"))
    nome = Column(String, nullable=False)
    rtsp_url = Column(String, nullable=False)
    ativo = Column(Boolean, default=True)
    criado_em = Column(DateTime, default=lambda: datetime.now(UTC))
    empresa = relationship("Empresa", back_populates="cameras")
    eventos = relationship("Evento", back_populates="camera")

class Evento(Base):
    __tablename__ = "eventos"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    camera_id = Column(UUID(as_uuid=True), ForeignKey("cameras.id"))
    tipo = Column(String, nullable=False)
    confianca = Column(Float)
    criado_em = Column(DateTime, default=lambda: datetime.now(UTC))
    camera = relationship("Camera", back_populates="eventos")

class LinhaContagem(Base):
    __tablename__ = "linhas_contagem"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    camera_id = Column(UUID(as_uuid=True), ForeignKey("cameras.id"), unique=True)
    x1 = Column(Float, nullable=False)
    y1 = Column(Float, nullable=False)
    x2 = Column(Float, nullable=False)
    y2 = Column(Float, nullable=False)
    criado_em = Column(DateTime, default=lambda: datetime.now(UTC))
    atualizado_em = Column(DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))

class HeatmapPonto(Base):
    __tablename__ = "heatmap_pontos"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    camera_id = Column(UUID(as_uuid=True), ForeignKey("cameras.id"))
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    peso = Column(Float, default=1.0)
    criado_em = Column(DateTime, default=lambda: datetime.now(UTC))