#!/bin/sh
# Executed by launchd. Machine-specific values arrive via EnvironmentVariables
# in the installed plist, not from this file.
set -eu

cd "$(dirname "$0")/.."

: "${OP_ENVIRONMENT_ID:?not set - reinstall with deploy/install.sh}"
: "${OP_TOKEN_FILE:?not set - reinstall with deploy/install.sh}"

OP_SERVICE_ACCOUNT_TOKEN="$(cat "$OP_TOKEN_FILE")"
export OP_SERVICE_ACCOUNT_TOKEN

# op injects the Environment's variables into node's environment and forwards
# signals to it, so launchd supervises a single process tree with no secrets on disk.
exec op run --environment "$OP_ENVIRONMENT_ID" -- node dist/index.js
