#!/usr/bin/env bash
# Despliega un release inmutable de Cobranzas. Produccion no es checkout Git.
#   ./deploy/deploy.sh --check    pruebas locales + preflight remoto, no cambia produccion
#   ./deploy/deploy.sh            pruebas, archive, SHA-256 y deploy remoto con candado
set -euo pipefail

HOST="${DEPLOY_HOST:-root@5.161.118.178}"
REMOTE_HELPER=/usr/local/sbin/deploy-apk-cobranza
REMOTE_INCOMING=/var/lib/cobranza-releases/incoming

die() { echo "ERROR: $*" >&2; exit 1; }
ok() { echo "OK: $*"; }
ssh_() { ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "$@"; }

repo_check() {
  [[ "$(git rev-parse --abbrev-ref HEAD)" == main ]] || die "solo se despliega desde main."
  local dirty
  dirty=$(git status --porcelain --untracked-files=all)
  [[ -z "$dirty" ]] || { printf '%s\n' "$dirty" >&2; die 'el arbol debe estar limpio: commitea o guarda el trabajo antes de desplegar.'; }
  git fetch -q origin main
  [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || die 'HEAD no coincide con origin/main. Haz push (o actualiza la rama) antes de desplegar.'
  ok "main limpio y sincronizado en $(git rev-parse --short HEAD)"
}

local_quality_gate() {
  ok 'ejecutando tests del backend...'
  (cd backend && npm ci && npm test)
  ok 'ejecutando tests y build del frontend...'
  (cd frontend && npm ci && npm test && npm run build)
  git diff --quiet || die 'las pruebas o el build modificaron archivos versionados; revisa el diff antes de desplegar.'
  ok 'tests y build locales correctos'
}

remote_check() {
  ssh_ "test -x $REMOTE_HELPER && $REMOTE_HELPER --check"
  ok 'preflight remoto correcto'
}

check() {
  repo_check
  local_quality_gate
  remote_check
}

deploy() {
  check
  local commit archive_dir archive archive_sha remote_archive
  commit=$(git rev-parse HEAD)
  archive_dir=$(mktemp -d "${TMPDIR:-/tmp}/cobranza-deploy.XXXXXX")
  archive="$archive_dir/cobranza-$commit.tgz"
  remote_archive="$REMOTE_INCOMING/cobranza-$commit.tgz"
  trap 'rm -rf "$archive_dir"' EXIT
  git archive --format=tar.gz --output="$archive" "$commit"
  archive_sha=$(sha256sum "$archive" | awk '{print $1}')
  scp -q "$archive" "$HOST:$remote_archive"
  ssh_ "$REMOTE_HELPER --deploy '$remote_archive' '$archive_sha' '$commit'"
  ok "release $commit desplegado; confirma /api/health y los flujos del negocio."
}

cd "$(git rev-parse --show-toplevel)"
case "${1:-}" in
  --check) check ;;
  '') deploy ;;
  *) die 'uso: deploy/deploy.sh [--check]' ;;
esac
