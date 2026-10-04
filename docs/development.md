# Development and operations guide

This guide holds the setup and operational detail intentionally kept out of the project overview. Use the canonical product/spec hierarchy in [`spec/README.md`](spec/README.md) and the live deployment guides below rather than treating this page as a product contract.

## Local development

Prerequisites: Node.js 22+, npm 10+, and Docker Compose v2 for the bundled services.

```bash
git clone https://github.com/quokkify/marketdesk.git
cd marketdesk
npm ci
cp .env.example .env
```

For Compose development, set the required values in `.env` before starting: `DB_SSL_MODE=disable`, a strong `JWT_SECRET`, and `HERMES_API_KEY` matching the key configured by the native Hermes API server. Review all other `.env.example` values; do not commit `.env`. Compose provides PostgreSQL 18 and Redis 8 and builds one combined application image that serves the API and SPA. The app binds to `127.0.0.1:3000` by default.

```bash
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/ready
```

Compose first initializes the persistent upload bind mount as UID/GID `1001:1001`, then runs ordered migrations, then starts the non-root application. A successful `/health` alone does not prove database/Redis readiness; use `/ready` too.

To run the application without Docker, start local PostgreSQL and Redis, set `.env` connection values for those services, then run `npm run dev`. The backend listens on port 3000 and Vite serves the frontend on port 5173.

## Checks and scripts

```bash
npm run lint
npm run type-check
npm test -- --runInBand
npm run build
npm run verify:spec
npm run verify:compose-db
npm run verify:compose-uploads
npm run verify:brand-assets
```

Other useful scripts: `npm run db:migrate`, `npm run db:seed`, `npm run dev:backend`, and `npm run dev:frontend`. Run formatters only on the files being changed; `npm run format` formats source files in place.

### Java test automation

Java 21 test automation is maintained in [`test-automation/`](../test-automation/) from the [java-test-automation-template](https://github.com/quokkify/java-test-automation-template). Its dependencies include q4j configuration and TestNG support, SQL database helpers, the Tyrus WebSocket client, Selenide UI helpers, and the PostgreSQL JDBC driver. q4j module versions share one version-catalog entry so they stay aligned. Run its static checks and tests with:

```bash
cd test-automation
./gradlew assemble testClasses checkstyleMain checkstyleTest spotbugsMain spotbugsTest
./gradlew test
```

The Java project has its own `.copier-answers.yml`; update it independently with Copier from inside `test-automation/`. CI uses [ci-kit](https://github.com/quokkify/ci-kit) and checks this project alongside the existing Node pipeline.

## Architecture and API

The system is a React/TypeScript SPA served by a Node/Express TypeScript API. PostgreSQL stores workspace-scoped data; Redis backs cache/queue responsibilities. Backend code is layered into domain, application, infrastructure, and presentation boundaries. The canonical architecture and product sources are linked from [`spec/README.md`](spec/README.md); implementation evidence and gaps are in [`spec/TRACEABILITY.md`](spec/TRACEABILITY.md).

API requests live under `/api`; `GET /health` is liveness and `GET /ready` checks service readiness. Auth is public; resource routes are authenticated and workspace-scoped. Inspect the route/controller implementation for the current endpoint contract rather than relying on an old copied endpoint inventory.

## Hermes integration boundary

MarketDesk connects to the native Hermes Agent API Server; it does not call a model provider directly. For a local Compose app, the default endpoint is `http://host.docker.internal:8642/v1`. Configure `API_SERVER_ENABLED`, `API_SERVER_HOST`, `API_SERVER_PORT`, and `API_SERVER_KEY` on the Hermes host, and set the matching app-side `HERMES_API_KEY` in the project `.env`.

The Hermes host must be reachable from Docker but must not be exposed publicly. If binding the server to `0.0.0.0` for host-gateway access, restrict port 8642 with host firewall/security-group rules to Docker traffic and trusted administration addresses. Authentication does not replace network isolation. Keep recommendations reviewable; approval, publish, relist, category changes, and quota overrides remain guarded operations.

## Data and deployment safety

- Treat `uploads/` and database/Redis volumes as persistent user data. Back up and verify before repair or migration; never use `docker compose down -v` on data you need.
- The Compose file mounts PostgreSQL 18 data at `/var/lib/postgresql`. Before reusing a pre-18 `postgres_data` volume, make a verified dump and restore into a fresh PG18 volume; otherwise the new mount may initialize an empty cluster.
- Release deployment is an in-place maintenance-window operation. Create and verify a fresh PostgreSQL, Redis, and uploads backup before migrations; a failed migration may leave the app unavailable until recovery.
- Compose's `upload-storage-init` one-shot service preserves files and assigns the fixed upload tree to UID/GID 1001:1001. Never bypass it with world-writable permissions. See [upload storage initialization and recovery](deployment/upload-storage.md).
- Keep required `DB_SSL_MODE`, `JWT_SECRET`, and `HERMES_API_KEY` values explicit. `DB_SSL_MODE=disable` is for internal Compose connections; use the documented verified TLS mode for external PostgreSQL.

## Deployment references

- [Caddy + Cloudflare VPS](deployment/caddy-cloudflare-vps.md): HTTPS routing, origin and host firewall boundary.
- [Installed release version](deployment/release-version.md): exact release-tag and fail-closed Compose procedure, immutable build context, migration gate, backup requirements and runtime version verification.
- [Upload storage](deployment/upload-storage.md): ownership contract, safe recovery, and upload persistence verification.
- [Container images](deployment/container-images.md): current GHCR publication/consumption contract and distinction between combined runtime and optional split images.

The standard repository Compose deployment currently builds and runs a single combined backend+SPA application image. Do not infer that separately published GHCR images replace this deployment path; see the container-images guide for the current contracts.

## Product maturity and contribution

OLX is the only validated real marketplace integration. Other channels are roadmap/unavailable and must not be presented as connected. Hermes recommendations are proposals for review, not unattended marketplace automation. MarketDesk remains a prototype and is not production-certified; see [project status](../.github/project-status.yml) and the [product maturity contract](spec/PRODUCT.md).

For changes, follow the project architecture and tests, update documentation where behavior changes, and open a pull request using the repository template. Do not test publication/sync against real marketplace data without explicit authorization. Never commit credentials, personal data, exports, or production data.
