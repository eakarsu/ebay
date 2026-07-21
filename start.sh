#!/usr/bin/env sh
set -eu

if [ "${DATABASE_URL:-}" = "" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

if [ "${COMMERCE_JWT_SECRET:-}" = "" ] && [ "${JWT_SECRET:-}" != "" ]; then
  export COMMERCE_JWT_SECRET="$JWT_SECRET"
fi

mode="${1:-start}"

if [ "$mode" = "migrate" ]; then
  exec npm run db:migrate
fi

if [ "$mode" = "worker" ]; then
  exec npm run worker
fi

if [ "$mode" = "api" ] || [ "$mode" = "start" ]; then
  exec npm run api
fi

echo "Usage: ./start.sh {start|migrate|api|worker}" >&2
exit 2
