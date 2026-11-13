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
selenium_port="${SELENIUM_PORT:-4444}"
export SELENIUM_PORT="$selenium_port"
export COMPOSE_FILE="docker-compose.yml:docker/selenium-grid/docker-compose.yml"

cd "$repo_root"

# The app refuses to start without a marketplace credentials key, and Compose requires the
# variable to be exported to render the stack, so give it a throwaway key on top of .env.example.
env_file="$(mktemp)"

cleanup() {
  rm -f "$env_file"
  docker compose down --volumes --remove-orphans
}
trap cleanup EXIT

credentials_key="$(openssl rand -base64 32)"
export MARKETPLACE_CREDENTIALS_KEY="$credentials_key"
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
  docker compose ps || true
  docker compose logs --no-color app migrate postgres redis selenium || true
  echo "MarketDesk API did not become ready" >&2
  exit 1
fi

grid_ready=false
for attempt in {1..60}; do
  if grid_status="$(curl --fail --silent "http://127.0.0.1:${selenium_port}/status")" \
    && [[ "$grid_status" =~ \"ready\":\ *true ]]; then
    grid_ready=true
    break
  fi
  sleep 2
done

if [[ "$grid_ready" != true ]]; then
  docker compose ps || true
  docker compose logs --no-color app migrate postgres redis selenium || true
  echo "Selenium Grid did not become ready" >&2
  exit 1
fi

export BROWSER_REMOTE_URL="http://127.0.0.1:${selenium_port}/wd/hub"
export MARKETDESK_UI_BASE_URI=http://localhost:3000

cd "$repo_root/test-automation"
gradle_status=0
./gradlew test apiTest uiTest --console=plain || gradle_status=$?

# Regression guard: the Allure results are published with the report even when tests fail, and a
# published access token fails the secret scan of every branch.
if [[ ! -d build/allure-results ]]; then
  echo "No Allure results to check for access tokens" >&2
  exit 1
fi
if grep -rlE 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' build/allure-results; then
  echo "The Allure results above carry an access token; keep it out of the report" >&2
  exit 1
fi
exit "$gradle_status"
