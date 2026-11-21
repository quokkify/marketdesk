# Find comparable used prices on OLX

Date: 2026-11-21. Status: draft for owner approval. Builds on PR #488 (price research and the
justified price estimate).

## Why

The price estimate is only as good as its used-price range. Without comparables Hermes guesses the
range from memory and labels it estimated; entering comparables by hand is the step sellers skip
(on 2026-11-21 the owner saved the retail anchor but no comparables). The owner wants MarketDesk to
find current used prices on OLX itself, so the floor and start price rest on the market.

A spike on 2026-11-21 ran the owner's Hermes with only the `web` toolset and found six live OLX
adverts for AirPods 4 with prices (290–399 PLN) and olx.pl links. Hermes web search works on the
host without new keys (search backend `openai-native`, extract backend `parallel`).

## Goals

- A **"Find comparables on OLX"** button in the product's Price research section.
- The search returns a list of OLX adverts (price, title, link). The seller sees it with checkboxes,
  all ticked by default, unticks what does not match, and adds the rest to the comparables.
- Added comparables keep their link and a `web` source mark; the next analysis uses them like any
  other comparable.
- The search never feeds the estimate without the seller's confirmation.

## Non-goals

- Automatic or scheduled searches, or searching as part of the Analyze run.
- Other marketplaces than OLX.pl.
- Proving that an advert still exists or that its title is accurate (OLX blocks automated fetches;
  the seller checks the link).
- Changing the price estimate logic from #488.

## Anti-goals

- Giving web access to the `marketdesk` profile, which receives seller text.
- Seller free text (description, notes) reaching the web-enabled agent.
- A link that is not an olx.pl advert reaching the seller's list.

## Constraints

- Hermes runs natively on the host; MarketDesk reaches it over HTTP through the port-8642 firewall
  (subnet 172.18.0.0/16). Profiles are multiplexed at `/p/<profile>/v1`.
- PR #467 makes MarketDesk refuse a Hermes profile with tools on. The research profile is the one
  exception and must be checked just as strictly: exactly the `web` toolset, nothing else.
- Tests: q4j live tests for behaviour the stack can run; Jest only for pure functions. The CI stack
  has no Hermes, so the real search is checked by hand on production.
- `product_price_research.comparables` is JSONB, so new comparable fields need no migration.

## Approaches considered

1. **Separate Hermes profile with only web search, called by the backend over the Hermes API**
   (chosen). Reuses the owner's Hermes subscription and its working web backends; isolation is a
   profile boundary that already exists for `marketdesk`.
2. Calling the `hermes` CLI from the app — impossible: the app runs in Docker, Hermes on the host.
3. A paid search API wired into the backend (Tavily, SerpAPI) — new key and bill, and our own
   result parsing, for what Hermes already does.
4. Enabling `web` on the `marketdesk` profile — rejected: that profile receives seller text.

Owner's choices: approach 1; a separate button with checkboxes rather than searching inside Analyze.

## Design

### Host: the research profile (owner-approved infra step, done at deploy)

- `hermes profile create marketdesk-research`, configured like `marketdesk` (no MCP, plugins off,
  memory off, `hooks: {}`, neutral SOUL.md, its own `API_SERVER_KEY`) except
  `platform_toolsets.api_server: [web]`.
- URL `http://<host gateway>:8642/p/marketdesk-research/v1`; key stored only in the deploy `.env`.
- Rollback: remove the two env keys (button shows "not configured"), then
  `hermes profile delete marketdesk-research`.

### Configuration

- `HERMES_RESEARCH_API_URL`, `HERMES_RESEARCH_API_KEY`, `HERMES_RESEARCH_TIMEOUT_MS`
  (default 180000). If URL or key is unset, the search answers "Market search is not configured"
  and the button shows that reason instead of searching.

### Tool guard

Before every search the backend asks `GET {researchUrl}/toolsets` (as `HermesHealthProbe` does for
the main profile). It proceeds only when the set of enabled toolsets is exactly `{web}`. Anything
else — more toolsets, none, unreachable — refuses with a clear 503 message naming the problem, never
the key.

### Research client

Reuse `HermesCompletionClient` with the research URL, key and timeout (same `HERMES_MODEL`, same
`/chat/completions` request, same usage sink with cost status from `HERMES_BILLING_MODE`), and its
tolerant JSON extraction (code fences, surrounding prose). The tool guard reuses the
`HermesHealthProbe` request with a stricter decision. **First implementation step (owner-approved
host action):** create the profile and record its real `/toolsets` answer and one real
`/chat/completions` search answer, so the guard and the parser are built against observed responses,
not assumptions. The `marketdesk` profile's `/toolsets` answer on 2026-11-21 was
`{"object":"list","platform":"api_server","data":[{"name":"web","enabled":false,"tools":["web_extract","web_search"]},…]}`.

### Query

Built by the backend from a fixed template plus sanitized product fields only:
- product name: URLs removed, characters limited to letters, digits, spaces and `-/.()+`, at most
  120 characters;
- condition label, category leaf name, listing currency.
The description, notes and other free text are never sent. The prompt asks for at most 10 current
OLX.pl adverts of the same model and variant, used condition, as strict JSON
`[{ "price": number, "currency": string, "title": string, "url": string }]`, and to return `[]`
rather than guess.

### Filtering the answer

Every candidate must pass, or it is dropped:
- `url` matches `^https://www\.olx\.pl/d/oferta/[a-z0-9-]+-CID\d+-ID[0-9A-Za-z]+\.html$` (query and
  fragment stripped before matching; OLX advert URLs end in an upper-case `-CID<n>-ID<id>` suffix,
  e.g. `…-bez-anc-CID99-ID1d1eUB.html`);
- `price` finite, `> 0` and `<= 100000`; `currency` equals the listing currency;
- `title` trimmed, at most 200 characters;
- not the seller's own advert: compare against the product's listing `externalUrl` after the same
  normalisation (`marketplaceListingId` is OLX's numeric id, e.g. `1085426829`, and does not appear
  in the URL, so it cannot be used);
- de-duplicated by URL.

A malformed answer (not JSON, not an array) gives "Hermes returned no usable results"; an empty
list after filtering gives "No comparable adverts found".

### API

`POST /api/products/:id/price-research/search` → `{ candidates: Candidate[], searchedAt }` where
`Candidate = { price, currency, title, url }`. Nothing is saved. One synchronous request: nothing on
the path sets a shorter limit (Caddy `reverse_proxy` has no response timeout, the app sets no server
timeout, Node's default request timeout is 300 s, the frontend sets none), so 180 s fits.
The search is offered only when the listing currency is PLN (OLX.pl); otherwise the button is
disabled with "OLX search needs a PLN listing". Workspace-scoped (another
workspace's product → 404), behind the AI rate limiter, and recorded in AI usage as feature
`research`, operation `searchComparables` (`ai_usage.feature`/`operation` are free VARCHAR(64), no
constraint to change).

### Storing chosen comparables

`PriceComparable` gains optional `url: string | null` and `source: 'manual' | 'web'` (absent means
`manual`). The existing PUT accepts them: `url` must be an https URL of at most 500 characters, and
for `source: 'web'` it must match the OLX advert pattern above (shared constant used by both the filter and the validator). The 10-comparable cap stays.

### Interface

- Price research section: button **Find comparables on OLX**, next to "Add comparable". While it
  runs (up to ~1–2 minutes) the button shows progress and is disabled.
- Results dialog: one row per candidate — checkbox (ticked), price, title, "Open on OLX" link (new
  tab, `noopener noreferrer`). A candidate whose URL is already saved is shown ticked-and-disabled
  ("already added"). Footer: "Add N selected". If existing + selected would exceed 10, the button
  is disabled with "Keep at most 10 comparables — untick some".
- Adding merges into the form's comparables (note = title) and saves the full list through the
  existing PUT; last write wins, as today (builder's call, recorded).
- Saved web comparables show a small "OLX" link next to the price.

Sketch:

```
Comparable used prices                [ Add comparable ] [ Find comparables on OLX ]

┌ Found on OLX (6) ─────────────────────────────────────────────┐
│ [x] 290 zł  Słuchawki Apple AirPods 4 (bez ANC)   Open on OLX ↗ │
│ [x] 320 zł  airpods 4 bez anc                     Open on OLX ↗ │
│ [ ] 399 zł  Airpods 4 prawie nowe z gwarancją     Open on OLX ↗ │
│ ...                                                             │
│                                      [ Cancel ] [ Add 5 selected ] │
└─────────────────────────────────────────────────────────────────┘
```

### Labels in the estimate

No change to #488's rules: comparables the seller saved count as observed. The card's used-range
line adds where they came from, e.g. `Used range 290–370 zł · observed (4 from OLX)`.

## Acceptance

- q4j API: search answers "not configured" on the stack (no research profile); PUT accepts web
  comparables with an OLX URL, rejects a non-OLX URL for `source: 'web'`, keeps `url` and `source`
  on read; another workspace → 404.
- Jest (pure): query sanitizing (URLs and odd characters removed, 120-char cap, description never
  present); candidate filter (each rule above); toolset guard decision (`{web}` only).
- Production by hand: on AirPods 4, the button lists OLX adverts with working links; adding them and
  re-running Analyze labels the used range observed and moves the start price toward the market.

## Left to the builder

File layout of the research client (alongside `HermesCompletionClient`/`HermesHealthProbe`),
exact prompt wording, the dialog component structure, and where the `source` mark is shown.
