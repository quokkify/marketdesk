#!/usr/bin/env bash

set -euo pipefail

run_suffix="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
postgres_container="marketdesk-postgres-${run_suffix}"
redis_container="marketdesk-redis-${run_suffix}"

cleanup() {
  docker rm -f "$postgres_container" "$redis_container" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker run --detach --rm \
  --name "$postgres_container" \
  --publish 5432:5432 \
  --env POSTGRES_USER=marketdesk \
  --env POSTGRES_PASSWORD=marketdesk \
  --env POSTGRES_DB=marketdesk \
  postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15

docker run --detach --rm \
  --name "$redis_container" \
  --publish 6379:6379 \
  redis:8-alpine@sha256:9d317178eceac8454a2284a9e6df2466b93c745529947f0cd42a0fa9609d7005

for _ in {1..30}; do
  docker exec "$postgres_container" pg_isready -U marketdesk >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$postgres_container" pg_isready -U marketdesk || { docker logs "$postgres_container"; exit 1; }

for _ in {1..30}; do
  [[ "$(docker exec "$redis_container" redis-cli ping 2>/dev/null)" == PONG ]] && break
  sleep 2
done
[[ "$(docker exec "$redis_container" redis-cli ping 2>/dev/null)" == PONG ]] || { docker logs "$redis_container"; exit 1; }

export NODE_ENV=test
export DATABASE_URL=postgresql://marketdesk:marketdesk@localhost:5432/marketdesk
export REQUIRE_DATABASE_TESTS=true
export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=marketdesk
export DB_PASSWORD=marketdesk
export DB_NAME=marketdesk
export REDIS_HOST=localhost
export REDIS_PORT=6379
export REDIS_PASSWORD=
export JWT_SECRET=ci_test_secret_not_for_production

npm run build:migrate
node dist/backend/migrate.js
npm run test:ci
npm run experiment:assistance
