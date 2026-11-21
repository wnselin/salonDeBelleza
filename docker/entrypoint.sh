#!/bin/sh
set -eu

# Миграции идемпотентны: уже применённые версии пропускаются.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Applying database migrations..."
  node dist/scripts/migrate.js
fi

exec node dist/server.js
