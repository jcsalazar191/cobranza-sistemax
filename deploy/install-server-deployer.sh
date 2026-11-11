#!/usr/bin/env bash
# Instala/actualiza el comando remoto de deploy y sincroniza el docker-compose.yml de produccion.
# No despliega codigo ni recrea contenedores.
set -euo pipefail

HOST="${DEPLOY_HOST:-root@5.161.118.178}"
ROOT="$(git rev-parse --show-toplevel)"
SOURCE="$ROOT/deploy/deploy-apk-cobranza.remote.sh"
COMPOSE_SOURCE="$ROOT/docker-compose.yml"
[[ -f "$SOURCE" ]] || { echo 'No se encontro el helper remoto.' >&2; exit 1; }
[[ -f "$COMPOSE_SOURCE" ]] || { echo 'No se encontro docker-compose.yml.' >&2; exit 1; }
bash -n "$SOURCE"

scp -q "$SOURCE" "$HOST:/tmp/deploy-apk-cobranza.new"
scp -q "$COMPOSE_SOURCE" "$HOST:/tmp/cobranza-compose.new"
ssh -o BatchMode=yes "$HOST" 'bash -s' <<'REMOTE'
set -e
install -d -m 0750 /var/lib/cobranza-releases/incoming /var/backups/cobranza
install -m 0750 /tmp/deploy-apk-cobranza.new /usr/local/sbin/deploy-apk-cobranza
rm -f /tmp/deploy-apk-cobranza.new

# El compose de produccion no es un checkout: necesita `image: ${APP_IMAGE:-...}` para promover la imagen candidata.
APP=/var/www/cobranza.sysfarma.pe
if ! cmp -s /tmp/cobranza-compose.new "$APP/docker-compose.yml"; then
  BAK="$APP/docker-compose.yml.bak-$(date +%Y%m%dT%H%M%S)"
  cp -p "$APP/docker-compose.yml" "$BAK"
  install -m 0644 /tmp/cobranza-compose.new "$APP/docker-compose.yml"
  if ! docker compose -p cobranzasysfarmape --env-file "$APP/.env" -f "$APP/docker-compose.yml" config -q; then
    cp -p "$BAK" "$APP/docker-compose.yml"
    echo 'compose invalido: se restauro el anterior' >&2
    exit 1
  fi
  echo "docker-compose.yml de produccion actualizado (respaldo $BAK); no se recreo ningun contenedor."
fi
rm -f /tmp/cobranza-compose.new
/usr/local/sbin/deploy-apk-cobranza --check
REMOTE
echo 'Helper remoto instalado y verificado; no se desplego ningun release.'
