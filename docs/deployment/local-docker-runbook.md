# Local Docker Runbook

This runbook starts the complete MarketDesk stack from a developer checkout. The app listens only on `127.0.0.1:3000`; PostgreSQL and Redis are also bound to localhost.

## Requirements

- Docker Desktop (or Docker Engine) running
- Docker Compose v2
- Git checkout of this repository
- Node.js 22+ and npm 10+, only to run `npm run env:init` (no `npm ci` needed for Docker)

## First start

From the repository root:

```bash
npm run env:init
```

This creates `.env` from `.env.example` and generates `JWT_SECRET`, `JWT_REFRESH_SECRET`, `HERMES_WEBHOOK_SECRET`, and `MARKETPLACE_CREDENTIALS_KEY`. It keeps every value that is already set, so it is safe to run again. Without Node.js, run `cp .env.example .env` and set those four values yourself, for example to the output of `openssl rand -base64 32`.

The app will not start without a valid `JWT_SECRET` (at least 32 characters, not a placeholder) and `MARKETPLACE_CREDENTIALS_KEY` (base64 of 32 bytes). Do not replace `MARKETPLACE_CREDENTIALS_KEY` after you connect a marketplace account: stored marketplace credentials can no longer be decrypted with a different key.

Set `HERMES_API_KEY` to the key configured by your local Hermes API server. Hermes is optional for core app startup, but Hermes-assisted features need a reachable API server and matching key. Keep OLX in stub mode and live publishing disabled unless you intentionally configure approved credentials.

Start the services:

```bash
docker compose up -d --build
```

The first startup builds the app image, initializes `./uploads`, waits for PostgreSQL/Redis, and runs database migrations before starting the app.

## Verify

```bash
docker compose ps
curl --fail http://localhost:3000/health
curl --fail http://localhost:3000/ready
```

Open <http://localhost:3000> for the web app. API routes are under `/api`.

## Logs and restart

```bash
docker compose logs -f app
# Stop containers while keeping database, Redis, and uploaded files:
docker compose down
# Start again:
docker compose up -d
```

## Reset local data

This permanently removes the Compose database and Redis volumes. Back up anything needed first:

```bash
docker compose down -v
```

Uploaded files are in `./uploads/` and are not removed by `down -v`.

## Troubleshooting

- Check `docker compose ps` and `docker compose logs app migrate postgres redis`.
- If the app cannot reach PostgreSQL or Redis, confirm the services are healthy and `DB_SSL_MODE=disable` is set in `.env`.
- If `docker compose up` stops with `MARKETPLACE_CREDENTIALS_KEY must be set`, or `docker compose ps` shows the app restarting, read `docker compose logs app`. It names each of `JWT_SECRET` and `MARKETPLACE_CREDENTIALS_KEY` that is empty, a placeholder, too short, or malformed, with the fix for that problem. `npm run env:init` fixes an empty or placeholder value. Replace a short or malformed value with the output of `openssl rand -base64 32`; if a marketplace account is already connected, restore the original `MARKETPLACE_CREDENTIALS_KEY` instead.
- The UI/API can run without Hermes; Hermes-assisted calls require a working host service at `HERMES_API_URL` and a matching `HERMES_API_KEY`.
- PostgreSQL data is stored in the Compose `postgres_data` volume. Do not remove it unless you intend to reset the local database.
