#!/bin/sh
set -eu

DATA_PATH="${DATA_DIR:-/app/data}"
RUN_UID="${APP_UID:-99}"
RUN_GID="${APP_GID:-100}"

mkdir -p "$DATA_PATH"

if [ "$(id -u)" = "0" ]; then
  chown -R "$RUN_UID:$RUN_GID" "$DATA_PATH" 2>/dev/null || true
  exec su-exec "$RUN_UID:$RUN_GID" "$@"
fi

exec "$@"
