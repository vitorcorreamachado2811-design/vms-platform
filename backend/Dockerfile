FROM python:3.11-slim

# Instala FFmpeg para conversão RTSP → HLS e captura de snapshots
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cria pasta /tmp/hls para os segmentos HLS (usada pelo stream)
RUN mkdir -p /tmp/hls

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]