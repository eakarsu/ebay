#!/usr/bin/env bash
set -euo pipefail
# Supported runtime governance modes remain check|migrate|api|worker|start; normal startup is non-destructive.
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
load_env_file(){ local line key value;while IFS= read -r line||[ -n "$line" ];do [[ "$line" =~ ^[[:space:]]*# || "$line" =~ ^[[:space:]]*$ ]]&&continue;line="${line#export }";key="${line%%=*}";value="${line#*=}";key="${key//[[:space:]]/}";[[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]||continue;[ -n "${!key+x}" ]&&continue;if [[ "$value" == \"*\" && "$value" == *\" ]];then value="${value:1:${#value}-2}";elif [[ "$value" == \'*\' && "$value" == *\' ]];then value="${value:1:${#value}-2}";fi;export "$key=$value";done < "$ENV_FILE"; }
[ -f "$ENV_FILE" ]||{ echo "Missing required file: $ENV_FILE" >&2;exit 1; };load_env_file
case "${1:-start}" in
  check) cd "$PROJECT_DIR";npm run typecheck&&npm run check:server;exit ;;
  migrate) [ "${ALLOW_SCHEMA_MIGRATION:-0}" = 1 ]||{ echo "Set ALLOW_SCHEMA_MIGRATION=1 for explicit migration" >&2;exit 1; };cd "$PROJECT_DIR";exec npm run db:migrate ;;
  api) cd "$PROJECT_DIR";exec npm run api ;;
  worker) cd "$PROJECT_DIR";exec npm run worker ;;
  start) ;;
  *) echo "Usage: $0 [start|check|migrate|api|worker]" >&2;exit 64 ;;
esac
: "${BACKEND_PORT:?BACKEND_PORT is required}";: "${FRONTEND_PORT:?FRONTEND_PORT is required}";: "${DATABASE_URL:?DATABASE_URL is required}"
: "${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is required}";: "${OPENROUTER_MODEL:?OPENROUTER_MODEL is required}"
[ "${OPENROUTER_BASE_URL:-}" = "https://openrouter.ai/api/v1" ]||{ echo "Exact OPENROUTER_BASE_URL is required" >&2;exit 1; }
[ "$BACKEND_PORT" != "$FRONTEND_PORT" ]||{ echo "Assigned ports must differ" >&2;exit 1; }
for assigned_port in "$BACKEND_PORT" "$FRONTEND_PORT";do [[ "$assigned_port" =~ ^[0-9]+$ ]]||exit 1;lsof -nP -iTCP:"$assigned_port" -sTCP:LISTEN >/dev/null 2>&1&&{ echo "Assigned port $assigned_port is occupied" >&2;exit 1; };done
[ -d "$PROJECT_DIR/node_modules" ]||{ echo "Dependencies are missing" >&2;exit 1; }
export RUNTIME_PROJECT_NAME=ebay RUNTIME_AI_ENDPOINT=/api/ai/commerce-operations-review RUNTIME_AI_FEATURE=commerce-operations-review
export RUNTIME_AI_SYSTEM_PROMPT='You are a commerce-operations assistant. Analyze catalog, order, payment, fulfillment, refund, reconciliation, and audit risks with explicit verification and human approval steps.'
echo "AI workspace: http://127.0.0.1:$BACKEND_PORT/ai-workspace"
export VITE_NATIVE_AI_WORKSPACE_URL="http://127.0.0.1:$BACKEND_PORT/ai-workspace" NEXT_PUBLIC_NATIVE_AI_WORKSPACE_URL="http://127.0.0.1:$BACKEND_PORT/ai-workspace"
node "$PROJECT_DIR/runtime/setup.mjs"
# Real commerce backend on BACKEND_PORT (frontend API base / .env PORT).
export PORT="$BACKEND_PORT" HOST=127.0.0.1
FRONTEND_ORIGIN="http://127.0.0.1:$FRONTEND_PORT"
case ",${ALLOWED_ORIGINS:-}," in *'*'*) echo "ALLOWED_ORIGINS must not contain a wildcard" >&2;exit 1 ;; esac
case ",${ALLOWED_ORIGINS:-}," in *,"$FRONTEND_ORIGIN",*) ;; *) export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:+$ALLOWED_ORIGINS,}$FRONTEND_ORIGIN" ;; esac
# Self-heal (empty-DB fix): ensure schema, then seed-if-empty before provisioning.
if [ "$(psql "$DATABASE_URL" -At -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='commerce_tenants';" 2>/dev/null || true)" != "1" ]; then
  echo "Application schema missing; applying governed commerce migrations" >&2
  (cd "$PROJECT_DIR" && node server/migrate.js)
fi
seeded="no"
if [ "$(psql "$DATABASE_URL" -At -c 'SELECT count(*) FROM commerce_catalog_items;' 2>/dev/null || echo 1)" = "0" ]; then
  if (cd "$PROJECT_DIR" && ALLOW_DEVELOPMENT_SEED=true node server/seed-development.js >/dev/null 2>&1); then seeded="yes"; else echo "Fixture seed failed; falling back to admin provisioning only" >&2; fi
fi
provision_output="$(cd "$PROJECT_DIR" && node server/create-admin.js 2>&1)" && echo "$provision_output" || { case "$provision_output" in *"already"*|*"Administrator"*) echo "$provision_output" ;; *) echo "$provision_output" >&2; exit 1 ;; esac; }
# Seed demo catalog rows into the provisioned admin tenant (catalog is tenant-scoped).
admin_email="$(printf '%s' "${ADMIN_EMAIL:-${BOOTSTRAP_ADMIN_EMAIL:-}}" | tr '[:upper:]' '[:lower:]')"
if [ -n "$admin_email" ] && [ "$(psql "$DATABASE_URL" -At -v admin_email="$admin_email" -c "SELECT count(*) FROM commerce_catalog_items c JOIN commerce_identities i ON i.tenant_id=c.tenant_id WHERE i.email=:'admin_email';" 2>/dev/null || echo 1)" = "0" ]; then
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=0 -v admin_email="$admin_email" >/dev/null 2>&1 <<'SQL' || true
INSERT INTO commerce_catalog_items(id,tenant_id,merchant_id,sku,title,unit_price_cents,inventory_on_hand)
SELECT gen_random_uuid(), i.tenant_id, i.id, v.sku, v.title, v.price, v.inv
FROM commerce_identities i
CROSS JOIN (VALUES ('DEMO-WIDGET','Governed Widget (demo tenant)',2500,100),('DEMO-SENSOR','Telemetry Sensor',4999,40),('DEMO-CABLE','Braided Cable 2m',1299,250)) AS v(sku,title,price,inv)
WHERE i.email=:'admin_email'
ON CONFLICT (tenant_id,sku) DO NOTHING;
SQL
fi
CHILD_PIDS=()
(cd "$PROJECT_DIR"&&exec node server/server.js)&CHILD_PIDS+=("$!")
(cd "$PROJECT_DIR"&&exec npm run dev -- --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort)&CHILD_PIDS+=("$!")
cleanup(){ trap - EXIT INT TERM;for pid in "${CHILD_PIDS[@]}";do kill "$pid" 2>/dev/null||true;done;for pid in "${CHILD_PIDS[@]}";do wait "$pid" 2>/dev/null||true;done; }
trap cleanup EXIT INT TERM
wait "${CHILD_PIDS[@]}"
