#!/bin/sh
set -eu

# The mounted volume belongs to root initially. Initialize only our application
# directory, then run Node and Chromium as the unprivileged application user.
task_data_dir="${DATA_DIR:-/var/data/whatsapp}"
if [ "$task_data_dir" = / ] || [ -z "$task_data_dir" ]; then
  echo "DATA_DIR inválido" >&2
  exit 1
fi
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$task_data_dir"
  chown node:node "$task_data_dir"
  chmod 700 "$task_data_dir"
  exec gosu node "$@"
fi
exec "$@"
