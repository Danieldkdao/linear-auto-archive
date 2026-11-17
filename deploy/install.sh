#!/bin/bash
# Installs the server as a boot-time LaunchDaemon on macOS.
# Run as your normal user; sudo is used only to place and load the plist.
set -euo pipefail

LABEL="com.linear-auto-archive.server"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$REPO/deploy/$LABEL.plist.template"
TARGET="/Library/LaunchDaemons/$LABEL.plist"
TOKEN_FILE="${OP_TOKEN_FILE:-$HOME/Library/Application Support/linear-auto-archive/op-token}"
ENV_ID="${1:-}"
PORT="${PORT:-12480}"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }

[ -n "$ENV_ID" ] || die "usage: deploy/install.sh <1password-environment-id>"
[ "$(id -u)" -ne 0 ] || die "run as your normal user, not root/sudo"
[ -f "$TEMPLATE" ] || die "missing template: $TEMPLATE"
[ -f "$REPO/dist/index.js" ] || die "dist/index.js not found - run: pnpm install && pnpm build"
[ -f "$REPO/deploy/run.sh" ] || die "missing deploy/run.sh"

for bin in node op curl plutil; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin not found on PATH"
done

if [ ! -f "$TOKEN_FILE" ]; then
  die "service account token not found at: $TOKEN_FILE
Create it without leaving the token in shell history:
  mkdir -p \"$(dirname "$TOKEN_FILE")\"
  read -rs TOKEN
  umask 077 && printf '%s' \"\$TOKEN\" > \"$TOKEN_FILE\"
  chmod 600 \"$TOKEN_FILE\" && unset TOKEN"
fi

PERMS="$(stat -f '%Lp' "$TOKEN_FILE")"
[ "$PERMS" = "600" ] || die "token file must be chmod 600 (currently $PERMS): $TOKEN_FILE"

info "Checking the service account can read the Environment"
OP_SERVICE_ACCOUNT_TOKEN="$(cat "$TOKEN_FILE")" \
  op run --environment "$ENV_ID" -- node -e '
    const required = ["NODE_ENV", "LINEAR_API_KEY", "LINEAR_WEBHOOK_SECRET", "DISCORD_WEBHOOK_URL"];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) { console.error("Environment is missing: " + missing.join(", ")); process.exit(1); }
  ' || die "preflight failed - check the token, its Environment access, and the Environment ID"

NODE_BIN_DIR="$(dirname "$(command -v node)")"
OP_BIN_DIR="$(dirname "$(command -v op)")"
SERVICE_PATH="$NODE_BIN_DIR:$OP_BIN_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

info "Rendering $TARGET"
PLIST="$(cat "$TEMPLATE")"
PLIST="${PLIST//@REPO@/$REPO}"
PLIST="${PLIST//@USER@/$(id -un)}"
PLIST="${PLIST//@HOME@/$HOME}"
PLIST="${PLIST//@PATH@/$SERVICE_PATH}"
PLIST="${PLIST//@ENV_ID@/$ENV_ID}"
PLIST="${PLIST//@TOKEN_FILE@/$TOKEN_FILE}"

TMP_PLIST="$(mktemp)"
trap 'rm -f "$TMP_PLIST"' EXIT
printf '%s\n' "$PLIST" > "$TMP_PLIST"
plutil -lint "$TMP_PLIST" >/dev/null || die "rendered plist is not valid"

mkdir -p "$REPO/logs"

info "Installing plist (sudo)"
sudo install -m 644 -o root -g wheel "$TMP_PLIST" "$TARGET"

if sudo launchctl print "system/$LABEL" >/dev/null 2>&1; then
  info "Removing previously loaded job"
  sudo launchctl bootout "system/$LABEL" || true
fi

info "Loading job"
sudo launchctl bootstrap system "$TARGET"
sudo launchctl enable "system/$LABEL"

info "Waiting for /health on port $PORT"
for _ in $(seq 1 15); do
  if curl -fsS "http://localhost:$PORT/health" >/dev/null 2>&1; then
    printf '\nInstalled and running.\n'
    curl -fsS "http://localhost:$PORT/health"; printf '\n'
    printf 'Logs: %s/logs/server.log\n' "$REPO"
    exit 0
  fi
  sleep 1
done

printf '\nerror: service did not become healthy within 15s\n' >&2
sudo launchctl print "system/$LABEL" | grep -E 'state|pid|last exit' >&2 || true
tail -n 20 "$REPO/logs/server.log" >&2 || true
exit 1
