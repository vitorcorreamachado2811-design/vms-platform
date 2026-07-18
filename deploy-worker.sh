#!/bin/bash
# deploy-worker.sh — envia worker.py para a VPS e reinicia o container
#
# Uso:
#   ./deploy-worker.sh                        # atualiza worker-tba-capivari (padrão)
#   ./deploy-worker.sh worker-teste           # atualiza outro container
#   ./deploy-worker.sh --rebuild              # rebuild completo da imagem (deps mudaram)
#   ./deploy-worker.sh worker-teste --rebuild

set -e

VPS="vitor@177.136.230.76"
VPS_DIR="/home/vitor/vms-platform/backend"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

WORKER="${1:-worker-tba-capivari}"
REBUILD=false

for arg in "$@"; do
  [[ "$arg" == "--rebuild" ]] && REBUILD=true
done

echo "==> Enviando worker.py para a VPS..."
scp "$LOCAL_DIR/worker.py" "$VPS:$VPS_DIR/worker.py"

if $REBUILD; then
  echo "==> Enviando Dockerfile e requirements..."
  scp "$LOCAL_DIR/Dockerfile"       "$VPS:$VPS_DIR/Dockerfile"
  scp "$LOCAL_DIR/requirements.txt" "$VPS:$VPS_DIR/requirements.txt"

  echo "==> Rebuild da imagem na VPS..."
  ssh "$VPS" "cd $VPS_DIR && docker build -t worker-image -f Dockerfile ."

  echo "==> Parando container $WORKER..."
  ssh "$VPS" "docker stop $WORKER && docker rm $WORKER"

  echo "==> Subindo novo container $WORKER..."
  ssh "$VPS" "
    EMPRESA_ID=\$(docker inspect $WORKER 2>/dev/null | python3 -c \"
import sys, json
envs = json.load(sys.stdin)[0]['Config']['Env']
for e in envs:
    if e.startswith('EMPRESA_ID='): print(e.split('=',1)[1])
\" 2>/dev/null || echo '')
    docker run -d --name $WORKER --restart unless-stopped \
      --env-file $VPS_DIR/secrets/worker.env \
      -e EMPRESA_ID=\$EMPRESA_ID \
      worker-image
  "
else
  echo "==> Copiando worker.py para dentro do container $WORKER..."
  ssh "$VPS" "docker cp $VPS_DIR/worker.py $WORKER:/app/worker.py"

  echo "==> Reiniciando $WORKER..."
  ssh "$VPS" "docker restart $WORKER"
fi

echo ""
echo "==> Deploy concluído. Logs:"
ssh "$VPS" "docker logs $WORKER --tail 15"
