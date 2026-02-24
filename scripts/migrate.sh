#!/bin/bash

set -euo pipefail

echo "🚀 Starting Folio migration..."

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$ROOT_DIR"

SUPABASE_CMD="supabase"
if [ -x "./node_modules/.bin/supabase" ]; then
  SUPABASE_CMD="./node_modules/.bin/supabase"
elif ! command -v supabase &> /dev/null; then
  SUPABASE_CMD="npx supabase@latest"
fi

if [ -z "${SUPABASE_PROJECT_ID:-}" ]; then
  read -p "👉 Enter Supabase Project ID: " SUPABASE_PROJECT_ID
fi

if [ -z "${SUPABASE_PROJECT_ID:-}" ]; then
  echo "❌ Error: SUPABASE_PROJECT_ID is required"
  exit 1
fi

if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "🔑 Using provided Supabase Access Token"
  export SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN"
fi

echo "🔗 Linking project: $SUPABASE_PROJECT_ID"
$SUPABASE_CMD link --project-ref "$SUPABASE_PROJECT_ID" --yes

echo "📂 Pushing database migrations..."
max_retries="${DB_PUSH_MAX_RETRIES:-3}"
attempt=1
while true; do
  set +e
  DB_PUSH_OUTPUT=$($SUPABASE_CMD db push --include-all --yes 2>&1)
  status=$?
  set -e

  echo "$DB_PUSH_OUTPUT"

  if [ $status -eq 0 ]; then
    break
  fi

  if echo "$DB_PUSH_OUTPUT" | grep -q "57P03\\|shutting down\\|Failed to create login role\\|connection reset"; then
    if [ $attempt -lt $max_retries ]; then
      wait_seconds=$((attempt * 10))
      echo "⏳ Database appears busy/restarting. Retrying in ${wait_seconds}s (${attempt}/${max_retries})..."
      sleep $wait_seconds
      attempt=$((attempt + 1))
      continue
    fi
  fi

  echo "❌ Database push failed"
  exit $status
done

echo "⚙️  Pushing Supabase project config..."
$SUPABASE_CMD config push --yes

if [ "${SKIP_FUNCTIONS:-0}" != "1" ]; then
  echo "⚡ Deploying Edge Functions..."
  if [ -d "supabase/functions" ]; then
    for dir in supabase/functions/*/ ; do
      func_name=$(basename "$dir")

      if [ ! -d "$dir" ] || [[ "$func_name" =~ ^[._] ]] || [ "$func_name" == "_shared" ]; then
        continue
      fi

      if [ -f "$dir/index.ts" ]; then
        echo "   Deploying $func_name"
        $SUPABASE_CMD functions deploy "$func_name" --no-verify-jwt --use-api --yes
      else
        echo "   ⏭️  Skipping $func_name (missing index.ts)"
      fi
    done
  fi
else
  echo "⏭️  SKIP_FUNCTIONS=1, skipping function deployment"
fi

echo ""
echo "✅ Folio migration completed"
echo ""
