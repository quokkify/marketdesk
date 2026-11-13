# Persistent settings contracts

Authenticated settings are principal-scoped under `/api/settings`; clients never send a workspace or user identifier.

- `GET|PATCH /workspace` — workspace name, currency, IANA timezone, and language.
- `GET|PATCH /preferences` — theme and interface density.
- `GET|PATCH /hermes` — autonomy level and validated Hermes guardrails.
- `GET /integrations` — read-only `available`/`configured` status of marketplaces.

The notification endpoints, and the Telegram and API-key items of the integrations list, were removed in the stage-focus cut (#444). The `notification_preferences` and `api_keys` tables remain in the database and nothing reads them. `GET|PATCH /hermes` has no screen; stored values still apply.

PATCH bodies are strict, reject unknown fields, and must contain at least one supported change. User records are filtered by both authenticated `workspaceId` and `userId`. User preference revisions are exposed and incremented on writes.

Secret management is deliberately outside this settings foundation. These routes do not create, rotate, accept, or return API keys, bot tokens, OAuth tokens, client secrets, password hashes, or credential payloads. Integration reads are redacted and do not claim a live provider connection. They report marketplace availability/configuration only. Existing marketplace credential endpoints retain their separate contracts. Write management remains in #145/#147 because settings does not yet have the required RBAC boundary.

CI applies all migrations before Jest and sets `REQUIRE_DATABASE_TESTS=true`, so an unavailable database or missing schema fails instead of silently skipping persistence coverage. The PostgreSQL settings suite runs against that already-migrated database, exercises repository persistence/concurrency/tenant constraints/cascades, and safely reruns migration 029 inside a rolled-back transaction. It does not destructively recreate a database and therefore does not claim to prove a full fresh install or every historical 001–028 upgrade path.
