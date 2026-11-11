#!/usr/bin/env bash
# Instalar como /usr/local/sbin/deploy-apk-cobranza. Se ejecuta en produccion.
# No obtiene codigo de Git: solo acepta un git archive ya verificado.
set -euo pipefail

APP_DIR=/var/www/cobranza.sysfarma.pe
RELEASE_ROOT=/var/lib/cobranza-releases
INCOMING="$RELEASE_ROOT/incoming"
COMPOSE_PROJECT=cobranzasysfarmape
COMPOSE_FILE="$APP_DIR/docker-compose.yml"
IMAGE=cobranzasysfarmape-app
SERVICE=app
PUBLIC_HEALTH=https://cobranza.sysfarma.pe/api/health
LOG=/var/log/cobranza-deploy.log
BACKUP_DIR=/var/backups/cobranza
LOCK=/var/lock/apk-cobranza-deploy.lock
KEEP_ROLLBACKS=5

die() { echo "deploy-apk-cobranza: $*" >&2; exit 1; }
log() { printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$LOG"; }
compose() { docker compose -p "$COMPOSE_PROJECT" --env-file "$APP_DIR/.env" -f "$COMPOSE_FILE" "$@"; }

health_json() {
  local url=$1
  curl --fail --silent --show-error --max-time 10 "$url"
}

commit_from_health() {
  sed -n 's/.*"commit":"\([0-9a-f]\{40\}\)".*/\1/p'
}

assert_current_health() {
  local local_health public_health
  local_health=$(health_json http://127.0.0.1:3100/api/health) || die 'el healthcheck privado actual no responde.'
  public_health=$(health_json "$PUBLIC_HEALTH") || die 'el healthcheck publico actual no responde.'
  [[ "$local_health" == *'"ok":true'*'"db":true'* ]] || die 'la app actual o su base no estan sanas.'
  [[ "$public_health" == *'"ok":true'*'"db":true'* ]] || die 'la ruta publica no llega a una app sana.'
}

wait_for_health() { # commit esperado
  local expected=$1 local_health public_health
  for _ in $(seq 1 20); do
    local_health=$(health_json http://127.0.0.1:3100/api/health 2>/dev/null || true)
    public_health=$(health_json "$PUBLIC_HEALTH" 2>/dev/null || true)
    if [[ "$local_health" == *'"ok":true'*'"db":true'* ]] &&
      [[ "$public_health" == *'"ok":true'*'"db":true'* ]] &&
      [[ "$(printf '%s' "$local_health" | commit_from_health)" == "$expected" ]] &&
      [[ "$(printf '%s' "$public_health" | commit_from_health)" == "$expected" ]]; then
      return 0
    fi
    sleep 3
  done
  return 1
}

with_lock() {
  exec 9>"$LOCK"
  flock -n 9 || die 'ya hay otro despliegue de Cobranzas en curso.'
  "$@"
}

check_server() {
  [[ -f "$COMPOSE_FILE" && -f "$APP_DIR/.env" ]] || die 'faltan docker-compose.yml o .env de produccion.'
  docker ps --format '{{.Names}}' | grep -qx 'cobranzasysfarmape-app-1' || die 'el contenedor app no esta corriendo.'
  assert_current_health
  log 'CHECK_OK app y PostgreSQL sanos'
}

cleanup_old_images() {
  docker images "$IMAGE" --format '{{.Tag}}' | grep '^rollback-pre-' | tail -n +$((KEEP_ROLLBACKS + 1)) |
    xargs -r -I{} docker rmi "$IMAGE:{}" >/dev/null 2>&1 || true
}

RELEASE_DIR=''; DEPLOY_DONE=0
cleanup_release() { [[ "$DEPLOY_DONE" == 1 || -z "$RELEASE_DIR" ]] || rm -rf "$RELEASE_DIR"; }

deploy() { # archivo SHA-256 commit
  local archive=$1 archive_sha=$2 commit=$3 short candidate release check_json pending_count rollback_safe rollback_tag running_image
  [[ "$archive" == "$INCOMING"/* ]] || die 'el archivo debe estar dentro del directorio incoming autorizado.'
  [[ "$archive" =~ ^$INCOMING/cobranza-[0-9a-f]{40}\.tgz$ ]] || die 'nombre de paquete invalido.'
  [[ "$archive_sha" =~ ^[0-9a-f]{64}$ ]] || die 'SHA-256 invalido.'
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || die 'commit invalido.'
  [[ -f "$archive" ]] || die 'el paquete no existe en incoming.'
  printf '%s  %s\n' "$archive_sha" "$archive" | sha256sum -c - >/dev/null || die 'el SHA-256 del paquete no coincide.'
  tar -tzf "$archive" | grep -Eq '(^|/)Dockerfile$' || die 'el paquete no contiene Dockerfile.'
  tar -tzf "$archive" | grep -Eq '(^|/)backend/package.json$' || die 'el paquete no contiene backend/package.json.'

  check_server
  short=${commit:0:12}
  candidate="$IMAGE:candidate-$short"
  release="$RELEASE_ROOT/$commit"
  [[ ! -e "$release" ]] || die "ya existe un release para $commit; no se sobrescribe."
  install -d -m 0750 "$RELEASE_ROOT" "$INCOMING" "$BACKUP_DIR"
  mkdir -m 0750 "$release"
  RELEASE_DIR=$release; trap cleanup_release EXIT   # si algo falla antes de terminar, no queda un release a medias que bloquee el reintento
  tar -xzf "$archive" -C "$release" --no-same-owner --no-same-permissions
  [[ -f "$release/Dockerfile" ]] || die 'release extraido sin Dockerfile en la raiz.'
  log "BUILD_START commit=$commit"
  docker build --build-arg "GIT_COMMIT=$commit" -t "$candidate" "$release" >/dev/null

  check_json=$(APP_IMAGE="$candidate" compose run --rm --no-deps "$SERVICE" node scripts/migrate-deploy.js --check | tail -n 1)
  pending_count=$(printf '%s' "$check_json" | sed -n 's/.*"pendingCount":\([0-9][0-9]*\).*/\1/p')
  rollback_safe=$(printf '%s' "$check_json" | sed -n 's/.*"rollbackSafe":\(true\|false\).*/\1/p')
  [[ "$pending_count" =~ ^[0-9]+$ && "$rollback_safe" =~ ^(true|false)$ ]] || die 'respuesta invalida del verificador de migraciones.'
  [[ "$rollback_safe" == true ]] || die 'hay migraciones sin rollback automatico; requiere una entrega planificada.'

  if (( pending_count > 0 )); then
    local dump="$BACKUP_DIR/pre-migration-$(date +%Y%m%dT%H%M%S)-$short.dump"
    log "BACKUP_START pending=$pending_count file=$dump"
    compose exec -T db pg_dump -U cobranza -Fc cobranza_db > "$dump"
    chmod 0600 "$dump"
    APP_IMAGE="$candidate" GIT_COMMIT="$commit" compose run --rm --no-deps "$SERVICE" node scripts/migrate-deploy.js --apply
    log "MIGRATIONS_OK pending=$pending_count backup=$dump"
  fi

  rollback_tag="rollback-pre-$short"
  # Respaldo = la imagen que corre AHORA (no :latest, que puede ir por detras).
  running_image=$(docker inspect -f '{{.Image}}' cobranzasysfarmape-app-1) || die 'no puedo leer la imagen en ejecucion.'
  docker tag "$running_image" "$IMAGE:$rollback_tag"
  log "APP_RECREATE commit=$commit"
  APP_IMAGE="$candidate" compose up -d --no-build --no-deps --force-recreate "$SERVICE" >/dev/null
  if wait_for_health "$commit"; then
    docker tag "$candidate" "$IMAGE:latest"   # que un `compose up` sin APP_IMAGE no vuelva a una version vieja
    DEPLOY_DONE=1
    cleanup_old_images
    log "DEPLOY_OK commit=$commit migrations=$pending_count"
    printf 'DEPLOY_OK %s\n' "$commit"
    return 0
  fi

  log "HEALTH_FAILED commit=$commit rollback=$rollback_tag"
  APP_IMAGE="$IMAGE:$rollback_tag" compose up -d --no-build --no-deps --force-recreate "$SERVICE" >/dev/null || true
  # Las migraciones de este despliegue fueron declaradas compatibles con la
  # imagen anterior. La BD no se restaura automaticamente: el dump es la red
  # de seguridad para un operador, nunca se revierten datos a ciegas.
  if assert_current_health; then
    log "ROLLBACK_OK commit=$commit rollback=$rollback_tag"
  else
    log "ROLLBACK_FAILED commit=$commit rollback=$rollback_tag"
  fi
  die "el nuevo release no paso healthcheck; se intento rollback de la imagen."
}

main() {
  case "${1:-}" in
    --check)
      [[ $# -eq 1 ]] || die 'uso: deploy-apk-cobranza --check'
      check_server
      ;;
    --deploy)
      [[ $# -eq 4 ]] || die 'uso: deploy-apk-cobranza --deploy ARCHIVE SHA256 COMMIT'
      deploy "$2" "$3" "$4"
      ;;
    *) die 'uso: deploy-apk-cobranza --check | --deploy ARCHIVE SHA256 COMMIT' ;;
  esac
}

with_lock main "$@"
