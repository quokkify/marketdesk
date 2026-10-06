#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project_name="marketdesk-java-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"

export COMPOSE_PROJECT_NAME="$project_name"
export NODE_ENV=test
export DB_SSL_MODE=disable
export DB_PASSWORD=marketdesk-ci
export JWT_SECRET=marketdesk-ci-jwt-secret
export HERMES_API_KEY=marketdesk-ci-hermes-key
export APP_PORT=3000

cd "$repo_root"

# The API layer refuses to wire without a marketplace credentials key and the server then
# answers only /health and /ready, so give the stack a throwaway key on top of .env.example.
env_file="$(mktemp)"

cleanup() {
  rm -f "$env_file"
  docker compose down --volumes --remove-orphans
}
trap cleanup EXIT

credentials_key="$(openssl rand -base64 32)"
grep -v '^MARKETPLACE_CREDENTIALS_KEY=' .env.example > "$env_file"
printf 'MARKETPLACE_CREDENTIALS_KEY=%s\n' "$credentials_key" >> "$env_file"
export MARKETDESK_ENV_FILE="$env_file"

docker compose up --build --detach

ready=false
for attempt in {1..90}; do
  if curl --fail --silent http://127.0.0.1:3000/ready >/dev/null; then
    ready=true
    break
  fi
  sleep 2
done

if [[ "$ready" != true ]]; then
  docker compose ps
  docker compose logs --no-color app migrate postgres redis
  echo "MarketDesk API did not become ready" >&2
  exit 1
fi

cd "$repo_root/test-automation"
./gradlew test apiTest --console=plain
