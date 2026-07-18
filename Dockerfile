FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    libglib2.0-0 \
    libgl1 \
    libxcb1 \
    libx11-6 \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download dos modelos na build — evita download em runtime
RUN python -c "from ultralytics import YOLO; YOLO('yolo11n-pose.pt'); YOLO('yolo11n.pt')"

COPY worker.py .

CMD ["python", "worker.py"]
