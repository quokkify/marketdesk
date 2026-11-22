# Products page: simpler, faster, shows whether views grow

Date: 2026-11-22. Status: approved by the owner.

## Why

The owner spends most of the day on the Products page while testing autopilot selling on one
marketplace (OLX). Today the table has ten columns and four of them carry no information: Markets is
always "—" (the catalogue API has no marketplace data), Cost is `null` for every imported OLX item, so
Profit is "—" too, and Tags shows the same four import tags on every row. The owner needs two things
from this page: start an AI analysis of a product in one click, and see whether a listing's views are
growing. The demo the owner reviewed (stage 1 and stage 2 layouts) was accepted without remarks.

## Goals

- Remove Markets, Cost, Profit and Tags from the table and the card view.
- Fix the missing gap between the opened Filters panel and the table.
- Analyze a product with Hermes from its row, and analyze several selected products in sequence.
- Approve or dismiss the resulting suggestions in place, under the row, without leaving the tab.
- Show views, their 7-day growth and a small trend line per product.
- Replace the empty Attention tab with a computed "Needs action" tab.
- Small daily-use fixes: short listing id instead of the long SKU, clickable row, two-line titles,
  a Sold tab.

## Non-goals

- Multi-marketplace display. Markets comes back later as a row of marketplace dots under the title,
  shown only when more than one marketplace is connected; not built now.
- Keyboard navigation of the table.
- A server-side bulk-analysis queue. Whole-catalogue runs stay disabled on purpose
  (`hermesApi.ts`, `RunHermesUseCase.ts`); bulk analysis is a client-side sequence of single runs.
- Changing which tags the OLX import writes, or what goes into Hermes prompts.
- Deleting data: cost price, tags and SKU stay in the data model, CSV export, search and the
  product page.

## Anti-goals

- A zero that reads as "nobody is looking" when the data is merely stale. A growth figure is shown
  only when the listing synced within the last 24 hours; otherwise the row says the data is stale.
- A "Needs action" tab that fills up with false alarms. "No view growth" must not fire on listings
  whose stats were not refreshed in the window.
- Analyze results that vanish silently. Each run ends visibly in the row: "N to review" or
  "no new suggestions" or the error.

## Constraints

- Hermes runs are synchronous, one product per request, rate-limited per workspace
  (`AI_RATE_LIMIT_PER_MINUTE`, default 10). Bulk analysis must run requests one at a time and stop
  with a clear message on HTTP 429.
- View history exists: every sync writes the views delta to `analytics_events`
  (`event_type='view'`, `quantity`, `listing_id`, `occurred_at`; `SyncMarketplaceHandler.ts`). Watcher
  deltas are not recorded. The first event per listing holds the whole historical total (migrations
  038, 039), so growth windows must exclude that baseline event or start after it.
- History resolution equals sync frequency. The default sync mode is `manual`; `hourly` runs once an
  hour. The prod mode must be checked before stage 2 ships; trend and "no growth" are meaningful only
  with `hourly`.
- Frontend tests have no DOM; new behaviour tests go to `test-automation` as live API/UI tests.
- The shared `Card` sets `height: 100%`; it must not change (it lays out card grids app-wide).

## Approaches

1. **Two stages, two PRs** (chosen by the owner). Stage 1 is frontend only and ships the simpler
   page fast; stage 2 adds the stats endpoint, the pending-suggestion counts, Needs action and the
   Views column.
2. One PR with everything. Rejected: one large change, longer wait, harder review.
3. Three steps (frontend, then Needs action on existing data, then views and AI counts). Rejected:
   Needs action would ship with half its reasons, and the same screen gets reworked twice.

## Stage 1 — frontend only

**Columns.** `[ ] | Product | Status | Price | Updated | AI | ⋮`. Markets, Cost, Profit, Tags are
removed from `ProductsTable` and `ProductsCards`. Table `minWidth`, the loading skeleton's cell count
and any column-count assumptions follow the new column set (derive them from one column list).
"Cost: low to high / high to low" leave the Sort menu; the `costPrice` values stay accepted in the
URL sort whitelist so old links keep working. The permanent Alert inside the Filters panel about
missing marketplace/margin filters is removed.

**Filters gap.** In `ProductsPage.tsx` the panel is `<Collapse><Card sx={{ mb: 2 }}>`. Inside MUI
Collapse's flex wrapper the card's `height: 100%` swallows the margin. Fix: put the spacing on a plain
wrapper inside Collapse (`<Collapse><Box sx={{ pb: 2 }}><Card …>`). Expected: 16px between the panel
and the table card when open, no gap left behind when closed.

**Product cell.** Title wraps to at most two lines (full title in a tooltip). The second line shows
`OLX · <advert id>` instead of `OLX-<workspace uuid>-<advert id>`; the full SKU is in the tooltip and
remains searchable. Non-OLX or manually created SKUs are shown as they are. The `↗` link to the OLX
advert appears in stage 2, when the listing URL is available.

**Clickable row.** The whole row opens the product, except the checkbox, the AI cell and the kebab.
It is a real link, so Cmd/Ctrl-click opens a new tab.

**Analyze from the row.** A ✦ icon button in a new AI column and an "Analyze with AI" item in the
kebab (the kebab item is the only entry point in the card view). It calls the existing `runHermes`
mutation (`POST /hermes/products/:id/run`, `trigger: 'manual'`) and reuses the product page's helpers
for the disabled reason, provider label and success wording (`ListingDetailsPage.tsx`). States:
idle → running (spinner, button disabled) → "N to review ▾" or "no new suggestions" or the error
text. If the listing SEO agent is disabled, the button is disabled with the same reason the product
page shows. In stage 1 the result lives for the session only.

**Review in place (owner, 2026-11-22).** The owner stays on the Active tab: reviewing a suggestion
must not navigate away or move the product to another tab. "N to review ▾" expands a row directly
under the product (full table width) listing its pending suggestions, each with Approve and Dismiss,
using the existing `HermesEventCard` (`compactReview` variant for SEO suggestions, `default`
otherwise) and its existing approve/dismiss mutations. The expansion opens by itself when a row
analysis returns at least one suggestion; one row is expanded at a time; clicking "N to review ▴"
collapses it. The count follows the live pending list (approve/dismiss invalidate it); when the last
suggestion is resolved the expansion closes and the cell reads "All reviewed". In the card view the
same list expands inside the card. Approving applies the change exactly as on the product page.

**Bulk analyze.** When rows are selected, the selection bar gets "Analyze selected" next to Export
CSV. It runs the selected products one by one, each row showing its own state, the bar showing
progress "3 / 12". On 429 it stops, keeps finished results, and says how many were not analyzed.

**Tabs.** All · Active · Attention · Drafts · Sold. Attention is hidden while its count is 0 (today
nothing sets that status). Sold uses the existing `sold` status.

**Search placeholder.** "Search name or OLX id".

## Stage 2 — backend + frontend

**Product stats endpoint.** A separate endpoint, following the `/conversations/awaiting` pattern, so
the `Product` contract does not change: `GET /products/stats` → `Record<productId, ProductStats>` for
the workspace, where `ProductStats` has the OLX listing's `views`, `watchers`, `messages`,
`viewsDelta7d`, `viewsByDay` (14 daily buckets), `lastSyncAt`, `externalUrl`, `listingStatus`.
`viewsDelta7d` and `viewsByDay` are sums of `analytics_events.quantity` for `event_type='view'`,
grouped by listing, excluding the baseline event. With one OLX listing per product today, stats are
the listing's; if a product has several listings, views and messages are summed and the status is
the worst one (error > expired > draft > live).

**Pending-suggestion counts.** `GET /hermes/events/pending-counts` → `Record<productId, number>` of
Hermes events in `pending_review`. The row's AI cell shows "N to review ▾" from this count, so
results survive reloads and can be reviewed in place without running a new analysis; a row analyze
run, approve and dismiss refresh it.

**Views column.** Replaces Updated: current views, then `▲ +N` (green) or "no growth" (grey) for 7
days, a 14-day trend line (single colour, no axes), and a muted line "N watching · N msgs · synced
2h ago". If `lastSyncAt` is older than 24 hours: the number plus "stale" in amber, no delta, no
trend. Not published: "—". Sorting by views and by 7-day growth is added (server-side, next to the
existing sort fields).

**Needs action.** The Attention tab becomes "Needs action", computed on the server; a product is in
it when any of these holds:

- a buyer is waiting for a reply (existing awaiting count);
- its OLX listing is expired or in error;
- no view growth for 7 days, counted only for live listings that synced within the last 24 hours
  and have been live for at least 7 days.

Each row in the tab shows its reasons in violet under the status. "Condition not confirmed"
(`product.condition === 'unknown'`) is shown as an amber hint under the status in every tab and does
not put a product into Needs action (owner's call not to include it). The tab count comes from the
same server computation.

**Listing link.** The product cell's `OLX · <id>` becomes a link to `externalUrl` (new tab).

## Calls made in the design (not owner decisions)

- **Baseline event** (revised 2026-11-22 after review). Growth counts only view events recorded by
  sync, which have deterministic UUID v5 ids; seeded pre-tracking totals (migrations 038/039, random
  v4 ids) are baseline wherever they fall in time. The earlier "earliest event per listing" rule
  dropped the first genuine delta and counted a seed replayed after the first sync as a spike.
  Checked on prod: the three seeds are v4, every sync delta is v5.
- **Needs action scope.** Only products with status `active`. Tab value `needs-action`; an old
  `?tab=attention` URL is mapped to it. The products list endpoint gets a `needsAction=true` filter
  and a count, computed in the application service (the catalogue is already filtered in memory
  there) from shared functions that the stats and pending-count endpoints also use; the awaiting
  query is extracted into a shared function rather than called over HTTP.
- **Re-analysis.** Allowed with pending suggestions present; duplicates are suppressed by the
  existing 30-day rule. "No new suggestions" means the run returned zero events.
- **Bulk lifetime.** Bulk analysis lives in page state and stops when the user leaves the page;
  finished results stay on the server.
- **Several listings per product.** `lastSyncAt` is the most recent, `externalUrl` is the live
  listing's (else the most recent), `viewsByDay` sums buckets. Out of scope to design further.
- **Stage 1 AI cell after reload** is blank until stage 2 brings persistent counts (accepted with
  the two-stage choice).

## Owner decisions recorded

- Remove Markets, Cost, Profit, Tags now; bring Markets back later without clutter.
- Needs action reasons: buyer waiting, listing expired/error, no view growth.
  Condition-not-confirmed stays a hint only. Pending AI suggestions do NOT put a product into Needs
  action (owner revised 2026-11-22): they are reviewed in place from the row on the Active tab.
- AI suggestions are approved or dismissed in a row expansion under the product, not on the product
  page and not in a side panel or popover (owner's pick).
- Two-stage delivery.
- OLX sync runs `hourly` on prod. Before stage 2 ships, the prod sync mode is checked; if it is
  `manual`, it is switched to `hourly` (a marketplace setting, not code). Stage 2's freshness and
  no-growth rules assume hourly sync.

## Left to the builder

- Exact component split, naming and where the column list lives.
- Whether the stats and pending counts are fetched once per page and refreshed after sync/analyze
  (expected) and their cache tags.
- Test placement per project rules (`test-automation` live tests for the filter gap, row analyze,
  stats endpoint and Needs action; pure-function unit tests for SKU shortening and stats formatting).
