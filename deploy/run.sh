#!/bin/sh
# Executed by launchd as root. The System keychain is unlocked at boot, so the
# token is readable before any login; it is then handed to the server process,
# which runs unprivileged as SERVICE_USER.
set -eu

cd "$(dirname "$0")/.."

: "${OP_ENVIRONMENT_ID:?not set - reinstall with deploy/install.sh}"
: "${SERVICE_USER:?not set - reinstall with deploy/install.sh}"
: "${SERVICE_HOME:?not set - reinstall with deploy/install.sh}"

KEYCHAIN=/Library/Keychains/System.keychain
KC_SERVICE=linear-auto-archive
KC_ACCOUNT=op-token

# Exported rather than passed as an argument so the token never appears in argv.
OP_SERVICE_ACCOUNT_TOKEN="$(/usr/bin/security find-generic-password -s "$KC_SERVICE" -a "$KC_ACCOUNT" -w "$KEYCHAIN")"
export OP_SERVICE_ACCOUNT_TOKEN
export HOME="$SERVICE_HOME"

# Absolute paths: sudo may reset PATH for the dropped process.
OP_BIN="$(command -v op)"
NODE_BIN="$(command -v node)"

exec /usr/bin/sudo -u "$SERVICE_USER" -E "$OP_BIN" run --environment "$OP_ENVIRONMENT_ID" -- "$NODE_BIN" dist/index.js
