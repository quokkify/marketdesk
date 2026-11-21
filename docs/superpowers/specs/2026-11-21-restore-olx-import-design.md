# Restore OLX advert import — design

## Intent

The owner connected a real OLX account and pressed Sync, expecting the adverts already live on
OLX to appear in MarketDesk. Nothing arrived: Sync only refreshes stats for listings MarketDesk
already holds, and the workspace holds none. Importing existing adverts is the way a seller with
live adverts starts using MarketDesk, so it has to be reachable again.

## Current state

- `MarketplaceImportService` (preview + import, transactional, audited) is still on `main`,
  constructed in `src/backend/config/di/container.ts`, and covered by its own tests.
- PR #448 removed its HTTP surface: `POST /api/marketplaces/:id/import-preview`,
  `POST /api/marketplaces/:id/import`, the controller methods, the sandbox guard (422 when the
  OLX adapter is not real) and their API tests.
- PR #447 removed the UI: the import action on the OLX marketplace card, the preview panel on the
  Marketplaces page, the RTK Query mutations and types, and their tests.

## Goals

- The two endpoints exist again with the behaviour they had before #448, including the sandbox
  guard and workspace ownership checks.
- The OLX card offers "Import from OLX". It opens a preview showing counts per status
  (discovered, new, changed, already imported, unsupported, failed) and **every** advert, not
  only the first five, with one action that imports the new and changed ones.
- The removed tests come back, adapted to current code.

## Non-goals

- Downloading images; imported products keep OLX image URLs, as before.
- Scheduled or automatic import; it stays a manual action.
- Changing `MarketplaceImportService` behaviour.

## Anti-goals

- Any write to OLX during preview or import.
- Import reachable in sandbox mode, or across workspaces.

## Approaches

1. **Restore the removed code, adapted to current `main` (chosen).** The service is intact and
   tested; only the surface is missing. Smallest change, known behaviour.
2. Rebuild import inside Sync. Rejected: Sync is a stats refresh queued as a job; merging the two
   changes Sync's contract and loses the preview step the owner wants.
3. A one-off server script to import. Rejected: not repeatable by the owner from the UI.

## Left to the builder

- Exact placement and styling of the preview panel, matching the current Marketplaces page.
- Rate limiting on the two endpoints, following how neighbouring marketplace routes are limited.
