#!/usr/bin/env bash
# Instala/actualiza solamente el comando remoto de deploy. No despliega codigo.
set -euo pipefail

HOST="${DEPLOY_HOST:-root@5.161.118.178}"
ROOT="$(git rev-parse --show-toplevel)"
SOURCE="$ROOT/deploy/deploy-apk-cobranza.remote.sh"
[[ -f "$SOURCE" ]] || { echo 'No se encontro el helper remoto.' >&2; exit 1; }
bash -n "$SOURCE"

scp -q "$SOURCE" "$HOST:/tmp/deploy-apk-cobranza.new"
ssh -o BatchMode=yes "$HOST" 'set -e
  install -d -m 0750 /var/lib/cobranza-releases/incoming /var/backups/cobranza
  install -m 0750 /tmp/deploy-apk-cobranza.new /usr/local/sbin/deploy-apk-cobranza
  rm -f /tmp/deploy-apk-cobranza.new
  /usr/local/sbin/deploy-apk-cobranza --check'
echo 'Helper remoto instalado y verificado; no se desplego ningun release.'
