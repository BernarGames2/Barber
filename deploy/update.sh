#!/bin/sh
# Atualiza o servidor para a versão mais recente do repositório.
# Uso (no servidor, na pasta do projeto): sh deploy/update.sh
set -eu
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
docker image prune -f >/dev/null
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env ps
