#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project_name="marketdesk-java-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"

export COMPOSE_PROJECT_NAME="$project_name"
export MARKETDESK_ENV_FILE=.env.example
export NODE_ENV=test
export DB_SSL_MODE=disable
export DB_PASSWORD=marketdesk-ci
export JWT_SECRET=marketdesk-ci-jwt-secret
export HERMES_API_KEY=marketdesk-ci-hermes-key
export APP_PORT=3000

cd "$repo_root"

cleanup() {
  docker compose down --volumes --remove-orphans
}
trap cleanup EXIT

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
