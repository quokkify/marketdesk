#!/usr/bin/env bash
# Checks the request log of a running MarketDesk stack: one "HTTP request" line per API call, the
# client-facing error code on a 4xx, and no secret-looking value anywhere in the log.
set -Eeuo pipefail

base="${MARKETDESK_API_BASE_URI:-http://127.0.0.1:3000}"
container="${MARKETDESK_APP_CONTAINER:-marketdesk-app}"
marker="logcheck-$(date +%s)-$RANDOM"
password="Pw-${marker}-x1"
oauth_code="code-${marker}"
since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
failures=0

fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }

curl -s -o /dev/null -X POST "$base/api/auth/login" -H 'Content-Type: application/json' -d '{}'
curl -s -o /dev/null "$base/api/products"
token="$(curl -s -X POST "$base/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${marker}@example.test\",\"password\":\"${password}\"}" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
[[ -n "$token" ]] || fail "registration returned no token"
curl -s -o /dev/null "$base/api/products" -H "Authorization: Bearer ${token}"
curl -s -o /dev/null "$base/api/marketplaces/olx/oauth/callback?code=${oauth_code}&state=${marker}"
curl -s -o /dev/null -X POST "$base/api/no-such-route?code=${oauth_code}"
curl -s -o /dev/null -X POST "$base/api/auth/login" -H 'Content-Type: application/json' -d '{"email":'
curl -s -o /dev/null "$base/"
sleep 1

logs="$(docker logs --since "$since" "$container" 2>&1)"
requests="$(grep '"msg":"HTTP request"' <<<"$logs" || true)"

expect() { grep -q "$1" <<<"$requests" || fail "$2"; }
expect '"method":"POST","path":"/api/auth/login","status":400' 'no 400 line for the invalid login'
expect '"code":"VALIDATION_ERROR"' 'the 400 line lacks VALIDATION_ERROR'
expect '"path":"/api/products","status":401' 'no 401 line for the unauthenticated product list'
expect '"path":"/api/products","status":200' 'no 200 line for the authenticated product list'
expect '"path":"/api/marketplaces/olx/oauth/callback"' 'no line for the OAuth callback'
expect '"path":"/api/no-such-route","status":404' 'no 404 line for an unknown API route'
# The status is whatever the app answers today (a malformed body is currently a 500); the line must exist.
expect '"path":"/api/auth/login","status":[0-9]*,"durationMs":[0-9]*,"error":{"code":"[A-Z_]*","message":"Unexpected end of JSON input"' 'no line for a malformed JSON body'
grep -q '"path":"/health"' <<<"$requests" && fail 'health checks are logged'
grep -q '"path":"/"' <<<"$requests" && fail 'non-API requests are logged'

for secret in "$password" "$oauth_code" "$token" "Bearer"; do
  [[ -n "$secret" ]] && grep -qF -- "$secret" <<<"$logs" && fail "the log contains a secret value (${secret:0:6}...)"
done

if (( failures > 0 )); then
  echo "$failures check(s) failed" >&2
  exit 1
fi
echo "request log checks passed"
