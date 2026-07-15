#!/bin/sh
# Se o arquivo de config nao existe no volume ainda, copia o default
if [ ! -f /config/mediamtx.yml ]; then
    echo "[ENTRYPOINT] Copiando mediamtx.yml padrao para /config/"
    cp /mediamtx.yml /config/mediamtx.yml
fi
echo "[ENTRYPOINT] Iniciando MediaMTX com /config/mediamtx.yml"
exec /mediamtx /config/mediamtx.yml
