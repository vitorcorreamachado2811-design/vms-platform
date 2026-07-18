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

WORKER="worker-tba-capivari"
REBUILD=false

for arg in "$@"; do
  case "$arg" in
    --rebuild) REBUILD=true ;;
    worker-*) WORKER="$arg" ;;
  esac
done

echo "================================================"
echo " Worker : $WORKER"
echo " Rebuild: $REBUILD"
echo " VPS    : $VPS"
echo "================================================"

echo ""
echo "==> Enviando worker.py..."
scp "$LOCAL_DIR/worker.py" "$VPS:$VPS_DIR/worker.py"

if $REBUILD; then
  echo "==> Enviando Dockerfile e requirements..."
  scp "$LOCAL_DIR/Dockerfile"       "$VPS:$VPS_DIR/Dockerfile"
  scp "$LOCAL_DIR/requirements.txt" "$VPS:$VPS_DIR/requirements.txt"

  echo "==> Coletando env vars do container atual (antes de parar)..."
  ssh "$VPS" bash << 'REMOTE'
    set -e
    WORKER_NAME="${WORKER:-worker-tba-capivari}"

    # Extrai env vars do container em formato KEY=VALUE, ignora PATH/HOME/etc internos do Python
    docker inspect "$WORKER_NAME" \
      --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | grep -v '^PATH=\|^HOME=\|^LANG=\|^LC_\|^TERM=' \
      > /tmp/worker_env_backup.txt

    echo "Env vars salvas:"
    cat /tmp/worker_env_backup.txt
REMOTE

  echo "==> Parando e removendo container $WORKER..."
  ssh "$VPS" "docker stop $WORKER && docker rm $WORKER"

  echo "==> Rebuilding imagem worker-image na VPS (pode demorar ~5min)..."
  ssh "$VPS" "cd $VPS_DIR && docker build -t worker-image -f Dockerfile . 2>&1"

  echo "==> Recriando container $WORKER com env vars originais..."
  ssh "$VPS" bash << REMOTE
    set -e
    docker run -d --name $WORKER \
      --restart unless-stopped \
      \$(awk '{print "--env " \$0}' /tmp/worker_env_backup.txt | tr '\n' ' ') \
      worker-image
    echo "Container $WORKER criado."
REMOTE

else
  echo "==> Copiando worker.py para dentro do container..."
  ssh "$VPS" "docker cp $VPS_DIR/worker.py $WORKER:/app/worker.py"

  echo "==> Reiniciando $WORKER..."
  ssh "$VPS" "docker restart $WORKER"
fi

echo ""
echo "==> Aguardando 5s para inicialização..."
sleep 5

echo "==> Últimos logs:"
ssh "$VPS" "docker logs $WORKER --tail 20"

echo ""
echo "==> Status dos containers:"
ssh "$VPS" "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'"
