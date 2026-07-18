#!/bin/bash
# create-worker.sh — cria um novo container worker para uma empresa
#
# Uso:
#   ./create-worker.sh <nome-empresa> <empresa-id>
#
# Exemplo:
#   ./create-worker.sh tba-capivari 123e4567-e89b-12d3-a456-426614174000
#
# Pré-requisito: imagem worker-image já construída na VPS.
# Se não estiver: ./deploy-worker.sh --rebuild

set -e

VPS="vitor@177.136.230.76"
VPS_DIR="/home/vitor/vms-platform/backend"

NOME="$1"
EMPRESA_ID="$2"

if [[ -z "$NOME" || -z "$EMPRESA_ID" ]]; then
  echo "Uso: ./create-worker.sh <nome-empresa> <empresa-id>"
  echo "Exemplo: ./create-worker.sh tba-norte 123e4567-e89b-12d3-a456-426614174000"
  exit 1
fi

CONTAINER="worker-$NOME"

echo "================================================"
echo " Criando worker: $CONTAINER"
echo " Empresa ID    : $EMPRESA_ID"
echo "================================================"

# Verifica se já existe
EXISTE=$(ssh "$VPS" "docker ps -a --filter name=^${CONTAINER}$ --format '{{.Names}}'")
if [[ -n "$EXISTE" ]]; then
  echo "ERRO: container $CONTAINER já existe. Remova antes:"
  echo "  ssh $VPS 'docker stop $CONTAINER && docker rm $CONTAINER'"
  exit 1
fi

# Verifica se a imagem existe
IMAGEM=$(ssh "$VPS" "docker images worker-image --format '{{.Repository}}'" 2>/dev/null)
if [[ -z "$IMAGEM" ]]; then
  echo "Imagem worker-image não encontrada na VPS."
  echo "Faça o build primeiro: ./deploy-worker.sh --rebuild"
  exit 1
fi

echo "==> Copiando env template do container existente como base..."
# Pega env do primeiro worker existente, substitui o EMPRESA_ID
BASE_WORKER=$(ssh "$VPS" "docker ps --filter name=worker- --format '{{.Names}}' | head -1")

if [[ -z "$BASE_WORKER" ]]; then
  echo "Nenhum worker existente para usar como template de env."
  echo "Crie manualmente o arquivo de env ou ajuste o script."
  exit 1
fi

ssh "$VPS" bash << REMOTE
  docker inspect "$BASE_WORKER" \
    --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | grep -v '^PATH=\|^HOME=\|^LANG=\|^LC_\|^TERM=' \
    | sed 's/^EMPRESA_ID=.*/EMPRESA_ID=$EMPRESA_ID/' \
    > /tmp/env_${NOME}.txt

  echo "Env gerado:"
  cat /tmp/env_${NOME}.txt

  docker run -d --name $CONTAINER \
    --restart unless-stopped \
    \$(awk '{print "--env " \$0}' /tmp/env_${NOME}.txt | tr '\n' ' ') \
    worker-image

  echo ""
  echo "Container $CONTAINER criado com sucesso."
REMOTE

echo ""
echo "==> Aguardando 8s para inicialização..."
sleep 8

echo "==> Logs iniciais:"
ssh "$VPS" "docker logs $CONTAINER --tail 15"

echo ""
echo "==> Containers ativos:"
ssh "$VPS" "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'"
