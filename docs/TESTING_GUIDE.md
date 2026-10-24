# MarketDesk tester guide

This guide takes you from a fresh clone to a tested seller journey: create an account, connect the sandbox OLX account, add a product with photos, publish it, review AI suggestions, and look at the dashboard and analytics. It assumes you did not build the project.

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
3. You land on the dashboard.

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
- OLX is the only channel you can connect. Every other marketplace is a roadmap card with no connect action.

Connect first, so that the product you create next can be published.

### 2. Create a product with photos

1. Choose **New product** in the top bar. The wizard has six steps: Photos, Basic info, Pricing, Category, Marketplaces and Review.
2. **Photos:** add 1 to 12 photos in JPEG, PNG or WebP format. The first photo is the cover. You can reorder photos or mark another one as the cover. **Create from photos** and **Start with title** ask the AI provider for a draft that you review. Nothing is saved until you apply it.
3. **Basic info:** name, SKU, a description of 20 to 2000 characters, condition and tags.
4. **Pricing:** cost and selling price. Selling below cost needs an explicit confirmation. Use a selling price above zero if you plan to publish: zero is allowed for drafts, but publication is blocked with "Listing price must be set before publish".
5. **Category:** one of the six product categories.
6. **Marketplaces:** select OLX.
7. **Review:** check the summary, then choose **Create product**. MarketDesk saves the product and opens an OLX listing draft. Nothing is published yet.

What to check: the product appears under **Products** with its photos, and the photos are still there after you reload the page.

### 3. Publish to OLX (sandbox)

1. Open the product from **Products**. Choose **Publish to OLX** to open the publication review. The listings table on the same page also has a **Publish** action.
2. Choose the exact OLX category: type at least two letters into **Search OLX categories**, choose **Find categories**, then pick a result. In sandbox mode the category list is a small built-in one (Cameras, Phones, Headphones, Computers, Clothing, Furniture, Equipment and Other), not the real OLX category tree. If a search finds nothing, try one of those words.
3. Review the price, the category path and any warnings, then choose **Confirm category and queue publish**. You see "Publication was accepted and queued."
4. Publication runs in the background. After a few seconds, reload the product page. The listing should change from Draft to Live and carry a **Sandbox** label.

What to check:

- A sandbox advert has no page on olx.pl, so the listing shows a **Sandbox advert** label where a real advert would have its **Open on OLX** link. No real advert was created.
- No publication quota, fee warning or OLX credentials come into play. The sandbox has no quota.
- **Check again** in the publication readiness check validates the saved product without publishing it.

### 4. Review Hermes suggestions

1. On the product page, choose **Suggest improvements**. You get proposed title and description wording and a price suggestion, each with its reason. They are for review only. To use one, edit the product or listing yourself.
2. Choose **Analyze with Hermes**. This asks the listing SEO agent, which is on by default under Settings (Hermes), for a recommendation about this product. Open **Hermes AI** in the sidebar, find the recommendation, and approve or dismiss it. Approving applies the change in MarketDesk and queues an update for any live listing of the product.

What to check:

- **Which provider answered.** With no Hermes server, which is the default for testers, suggestions come from the built-in offline heuristics. Their text ends with "Heuristic offline suggestion; Hermes was not consulted.", price suggestions carry low confidence, and the Hermes AI page shows which provider is active.
- **Review only.** Offline suggestions never apply themselves, whatever autonomy level you set in Settings.
- **Modest results.** Offline heuristics are simple rules: capitalisation and a condition suffix in titles, whitespace tidying in descriptions, and a price change only when the price is zero or a listing has many real views and no sales. Simulated sandbox views are not counted. "No suggestion" is a normal answer.

To try a real Hermes instead, set `HERMES_API_KEY` in `.env` to the key of a native Hermes Agent API Server that the app can reach, then run `docker compose up -d --force-recreate app`. See the [Hermes integration boundary](development.md#hermes-integration-boundary). `HERMES_PROVIDER_MODE` chooses the routing: `auto` (the default) uses Hermes while it is configured and reachable and the heuristics otherwise, `hermes` never falls back, and `offline` never calls Hermes.

### 5. Look at the dashboard and analytics

1. Open **Dashboard**. Your sandbox listing counts as an active listing. Items that need attention and recent activity are listed there.
2. Open **Analytics**. The sandbox has no buyers, so sales, revenue and profit stay empty. Views and watchers are simulated by the OLX sandbox and grow on every sync; a notice at the top of the page says so. Run a sync from **Marketplaces** to refresh listing numbers.

What to check: empty states say what is missing, and no chart or tile shows invented numbers.

## What works and known limitations

What works in this setup:

- Sign-up, sign-in and a workspace of your own.
- Product creation with photo upload, editing and below-cost confirmation.
- Connecting the sandbox OLX account, the publication review and publishing to the sandbox.
- Review-only AI suggestions from Hermes or the offline heuristics.
- Dashboard and analytics over what exists in your workspace.

Known limitations:

| Area | What you will see | Status |
| --- | --- | --- |
| Sandbox only | No real OLX call is ever made. The OLX connection, its category list and its publication quota are built-in stand-ins. Sandbox adverts have no OLX page and show a **Sandbox advert** label instead of a link. A real OLX connection needs approved OLX Partner API credentials and is not part of this setup. | Approved deviation: Sandbox mode |
| Importing OLX adverts | Unavailable in sandbox mode. An import action, if shown, reports that import is not available in sandbox mode. | Approved deviation: Sandbox mode |
| Other marketplaces | Roadmap cards with no connect action. | Approved deviation: Marketplace availability |
| Offline AI | Without a reachable Hermes Agent API server, suggestions come from simple built-in heuristics. They are labelled as offline and always wait for review. | Approved deviation: Sandbox mode |
| Hermes runs | Whole-catalogue and scheduled runs are not started from the UI. Analyze one product at a time. Every analysis is review-only. | Open gap, see [TRACEABILITY.md](spec/TRACEABILITY.md) |
| Security, API keys, Telegram | Settings shows them as roadmap panels or disabled rows labelled "Not available in this release". | Approved deviation: Settings |
| Bulk actions | After selecting products, Add tag, Edit price and Delete are disabled. Export CSV works for the selection. | Open gap, see [TRACEABILITY.md](spec/TRACEABILITY.md) |
| Notifications | The notifications button is disabled. | Open gap, see [TRACEABILITY.md](spec/TRACEABILITY.md) |
| Analytics | No sales in sandbox, because there are no buyers. Views and watchers are simulated by the OLX sandbox, grow on every sync and are labelled as sandbox data. | Consequence of the sandbox |
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
