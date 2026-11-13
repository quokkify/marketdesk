# MarketDesk tester guide

This guide takes you from a fresh clone to a tested seller journey: create an account, connect the sandbox OLX account, add a product with photos, publish it, and review AI suggestions. It assumes you did not build the project.

MarketDesk is a prototype and is not production-certified (see the [project status](../.github/project-status.yml)). Report anything that looks broken, and anything that looks real but should not be.

Two defaults shape every step:

- **OLX is a sandbox.** In this setup MarketDesk never contacts OLX. Publishing creates a stand-in advert inside MarketDesk, and the OLX connection is labelled **Sandbox** wherever it appears.
- **Hermes is optional.** Without a reachable Hermes Agent API server, AI suggestions come from simple built-in heuristics. They say so, and every suggestion waits for your review.

## Prerequisites

- Docker with Compose v2 (`docker compose version` must work), running.
- Git.
- Node.js 22+ and npm 10+, used only to run `npm run env:init`. You do not need `npm ci` for Docker. Without Node.js, follow the manual `.env` steps in the [local Docker runbook](deployment/local-docker-runbook.md).
- Free local ports 3000, 5432 and 6379. The stack binds them to `127.0.0.1` only.
- A current desktop browser and a few product photos in JPEG, PNG or WebP format.

You do not need an OLX account, OLX credentials or a Hermes server.

## Start the stack

```bash
git clone https://github.com/quokkify/marketdesk.git
cd marketdesk
npm run env:init
docker compose up -d --build
```

`npm run env:init` creates `.env` from `.env.example` and generates the secrets the app needs: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `HERMES_WEBHOOK_SECRET` and `MARKETPLACE_CREDENTIALS_KEY`. It keeps any value that is already set, so running it again is safe. If a key is repeated without a real value after a line that sets one, it leaves both lines as they are, prints a warning and exits 1. `.env` is git-ignored and private: never share it. Leave the other defaults alone, because they select the sandbox and the automatic AI mode.

The first start builds the application image, so it takes a while. Compose then prepares the uploads folder, runs the database migrations and starts the app.

Check that it works:

```bash
docker compose ps
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/ready
curl -fsS http://127.0.0.1:3000/api/application-info
```

- `docker compose ps` lists `app`, `postgres` and `redis` as running.
- `/health` answers `"status":"ok"`. `/ready` answers `"status":"ready"` once PostgreSQL and Redis are connected.
- `/api/application-info` answers `{"success":true,"data":{"version":"Development"}}`. A JSON answer here proves the API routes are mounted, which `/health` alone does not.

Then open <http://localhost:3000>. Use `localhost`, not `127.0.0.1`, for the whole session. Connecting the sandbox OLX account sends your browser back to `http://localhost:3000/marketplaces` (the default `OLX_OAUTH_SUCCESS_URL`), and your sign-in is stored per address. Signing in on one address and being sent to the other shows the sign-in page again.

The app logs its active modes once at startup. Look for `Runtime modes` in `docker compose logs app`: the OLX adapter mode should be `stub` (the sandbox) and the Hermes provider mode `auto`.

### If it does not start

- **`docker compose up` stops with `MARKETPLACE_CREDENTIALS_KEY must be set`, or `app` keeps restarting.** Run `npm run env:init`, then `docker compose up -d --force-recreate app`. The app refuses to start while `JWT_SECRET` or `MARKETPLACE_CREDENTIALS_KEY` is missing or a placeholder. `docker compose logs app` shows one `Invalid startup configuration` message that names each problem and the fix.
- **`/ready` answers `not_ready`.** PostgreSQL or Redis is not up yet. Wait a little, then check `docker compose ps` and `docker compose logs postgres redis`.
- **A port is already in use.** Stop whatever uses it. A local PostgreSQL on 5432 or Redis on 6379 is the usual cause.
- **You see the sign-in page again after connecting OLX.** You opened the app on `127.0.0.1`. Open <http://localhost:3000> instead.

### Stop, update, start over

- `docker compose down` stops the stack and keeps your data.
- After `git pull`, run `docker compose up -d --build`. Pending database migrations run before the app starts.
- `docker compose down -v` permanently deletes the local database and Redis volumes, which means every account, product and listing. Photos in `./uploads` are kept. Use it only when you want a clean slate.

## Create an account

1. Open <http://localhost:3000>. You are sent to the sign-in page.
2. Choose **Create an account**, enter your e-mail, a workspace name and a password of at least 8 characters, then choose **Create account**.
3. You land on **Products**.

A workspace is created automatically; you can name it during sign-up. It also gets a disconnected OLX entry, which you connect in the first step below. All data is scoped to your workspace.

There is no e-mail confirmation and no password reset in this build, so keep the password you chose.

## The journey to test

Follow the steps in order. Each step lists what you should see. If reality differs, report it.

### 1. Connect the sandbox OLX account

1. Open **Marketplaces** in the sidebar.
2. On the OLX card, choose the connect button (**Connect sandbox OLX** while the sandbox is active). OLX asks for no login and no credentials, and nothing is sent to OLX.
3. You return to the Marketplaces page with a confirmation message, and the OLX card shows **Connected** with a **Sandbox** label.

What to check:

- A **Sandbox** label is shown wherever OLX state appears: the Marketplaces page, Settings (Marketplace accounts), the product wizard, the product page and the publication review. OLX state that looks real without that label is a bug.
- OLX is the only marketplace MarketDesk shows. There is no other channel to connect.
- While OLX is connected, the OLX card has a **Sync now** button. It refreshes the listing state from the sandbox; views and watchers are simulated and grow on every sync.

Connect first, so that the product you create next can be published.

### 2. Create a product with photos

1. Choose **New product** in the top bar. The wizard has two screens: **Photos**, then **Review and publish**.
2. **Photos:** add 1 to 12 photos in JPEG, PNG or WebP format. The first photo is the cover. You can reorder photos or mark another one as the cover. Choose **Continue**.
3. **Review and publish:** fill in the name, a description of 20 to 2000 characters, the condition and the selling price. The cost price is optional; selling below cost needs an explicit confirmation. There is no SKU field: the server generates one.
4. **OLX category:** type a word such as "camera" into **OLX category** and pick a result from the list. In sandbox mode the category list is a small built-in one (Cameras, Phones, Headphones, Computers, Clothing, Furniture, Equipment and Other), not the real OLX category tree. If a search finds nothing, try one of those words. **Change** replaces the chosen category; **Publish to OLX** stays disabled until a new one is picked.
5. Choose **Publish to OLX**. It stays disabled, with the reason shown above the buttons, until the photos, name, description, a price above 0 and a category are in place. Without a connected OLX account, **Save as draft** is the only way to finish.

What to check: the product appears under **Products** with its photos, and the photos are still there after you reload the page.

### 3. Publish to OLX (sandbox)

1. After **Publish to OLX** in the wizard, MarketDesk saves the product, opens its page, creates the OLX listing draft with the chosen category and checks it. When the check passes with the same category, the advert is queued without a second dialog and you see "Publication was accepted and queued."
2. When the check needs a decision (a quota or fee warning, a blocker, or a category that differs from the one you chose), the publication review opens instead. Review the price, the category path and any warnings, then choose **Confirm category and queue publish**. The same review opens from **Publish to OLX** on the product page and from the **Publish** action in its listings table.
3. Publication runs in the background. The product page checks the listing every 5 seconds for up to 2 minutes. The listing should change from Draft to Live and carry a **Sandbox** label. If OLX reports a failure, the page shows it in full in an alert; if nothing changes in 2 minutes, the page says "Still waiting for OLX. Refresh this page in a minute."

What to check:

- A sandbox advert has no page on olx.pl, so the listing shows a **Sandbox advert** label where a real advert would have its **Open on OLX** link. No real advert was created.
- No publication quota, fee warning or OLX credentials come into play. The sandbox has no quota.
- **Check again** in the publication readiness check validates the saved product without publishing it.

### 4. Review Hermes suggestions

1. On the product page, choose **Suggest improvements**. You get proposed title and description wording and a price suggestion, each with its reason. They are for review only. To use one, edit the product or listing yourself.
2. Choose the analyze button. It reads **Analyze with Hermes** while a Hermes Agent API server is configured and reachable, and **Analyze (offline heuristics)** when the built-in heuristics answer, which is the default for testers. While the provider status is still loading or unknown, the button reads a bare **Analyze**. This asks the listing SEO agent, which is switched on by default, for a recommendation about this product. Open **Hermes AI** in the sidebar, find the recommendation, and approve or dismiss it. Approving applies the change in MarketDesk and queues an update for any live listing of the product.

What to check:

- **Which provider answered.** With no Hermes server, which is the default for testers, suggestions come from the built-in offline heuristics. Their text ends with "Heuristic offline suggestion; Hermes was not consulted.", price suggestions carry low confidence, and the Hermes AI page shows which provider is active.
- **Review only.** Offline suggestions never apply themselves, whatever autonomy level is stored for the workspace.
- **Modest results.** Offline heuristics are simple rules: capitalisation and a condition suffix in titles, whitespace tidying in descriptions, and a price change only when the price is zero or a listing has many real views and no sales. Simulated sandbox views are not counted. "No suggestion" is a normal answer.

To try a real Hermes instead, set `HERMES_API_KEY` in `.env` to the key of a native Hermes Agent API Server that the app can reach, then run `docker compose up -d --force-recreate app`. See the [Hermes integration boundary](development.md#hermes-integration-boundary). `HERMES_PROVIDER_MODE` chooses the routing: `auto` (the default) uses Hermes while it is configured and reachable and the heuristics otherwise, `hermes` never falls back, and `offline` never calls Hermes.

## What works and known limitations

What works in this setup:

- Sign-up, sign-in and a workspace of your own.
- Product creation with photo upload, editing and below-cost confirmation.
- Connecting the sandbox OLX account, the publication review and publishing to the sandbox.
- Review-only AI suggestions from Hermes or the offline heuristics.

Known limitations:

| Area | What you will see | Status |
| --- | --- | --- |
| Sandbox only | No real OLX call is ever made. The OLX connection, its category list and its publication quota are built-in stand-ins. Sandbox adverts have no OLX page and show a **Sandbox advert** label instead of a link. A real OLX connection needs approved OLX Partner API credentials and is not part of this setup. | Approved deviation: Sandbox mode |
| Offline AI | Without a reachable Hermes Agent API server, suggestions come from simple built-in heuristics. They are labelled as offline and always wait for review. | Approved deviation: Sandbox mode |
| Hermes runs | There is no whole-catalogue run and no scheduled run at all. Hermes analyzes one product at a time, on request, and every analysis is review-only. | Removed for the stage focus (#444) |
| Price edits | Editing the price of a live listing by hand changes MarketDesk only. OLX is updated only when the listing is published again. Approving a Hermes price suggestion applies the price and queues an update for live listings. | By design |
| Accounts | No e-mail confirmation, password reset or password change. | Not built yet |

The approved deviations are recorded in [PRODUCT.md](spec/PRODUCT.md). Anything else that looks broken is worth reporting.

## How to report a bug

Open an issue at <https://github.com/quokkify/marketdesk/issues>. The repository is public, so leave out anything private. Never paste `.env`, tokens or passwords.

Please include:

- The steps you took, what you expected and what happened.
- A screenshot. Crop out personal data.
- The page address from the browser bar and the time it happened, with your time zone.
- For a failed action: in the browser developer tools, open the Network tab, select the failed `/api/...` request, and copy its status code and the error `code` and `message` from its response body. For a 500, paste only that `code` and `message`, and remove anything in them that looks like a file path or a token: in the default development mode the message is the raw server error.
- The last lines of the app log from `docker compose logs --no-color --tail=200 app`. Read them before pasting.
- The output of `docker compose ps`, the answer of `/api/application-info`, and the commit from `git rev-parse --short HEAD`.
- Your browser and operating system.

A short template:

```text
What I did:
What I expected:
What happened:
Page address and time:
Failed request (status, error code and message):
Commit and browser:
```
