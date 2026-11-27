# Advert Completeness Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MarketDesk keeps OLX attributes on every advert update and adds three sale verdict checks: category, attributes and delivery. The attributes check fills verifiable values on its own; everything else becomes a one-click proposal.

**Architecture:**
- Part 1 widens `OLXAdapter.doUpdateListing`'s pre-`PUT` read to merge the remote attributes into the body.
- Part 2 adds an optional OLX catalogue capability to the marketplace adapter: category suggestion, category attributes, advert fields and a field update. It also adds an advert-page delivery reader on the existing OLX page client and three self-contained check subgraphs wired into `SaleVerdictGraph`.
- The three checks share one lazily loaded, per-run `OlxAdvertSnapshot`.
- Proposals reuse `HermesEvent`. A category move reuses the existing `category_recreation` flow.

**Tech Stack:** TypeScript, Express, LangGraph `StateGraph`, Postgres 18, Jest (pure rules and the adapter only), q4j Java 21 live tests in `test-automation/` (TestNG, Allure, MockServer).

**Spec:** `docs/superpowers/specs/2026-11-27-advert-completeness-checks-design.md`

## Global Constraints

- OLX `PUT /adverts/{id}` is a full replace: every write goes through the Part 1 merge (remote attributes + owned/explicit ones + `ad_delivery`).
- Never overwrite an attribute already set on the advert. Fill only empty, enumerated, single-value attributes (`allow_multiple_values: false`, non-empty `values`). Never `delivery` as an attribute.
- "Verifiable" = exactly one allowed value label occurs as a whole word, case- and diacritic-insensitive, in `product.name` or `product.description`.
- The attributes check is the only writer during a verdict run: one `PUT` per run, an idempotency key over the listing and the values, and a re-read afterwards. Category and delivery only propose.
- Delivery packages are written only through `ad_delivery.delivery_package_ids`. A delivery proposal is a parcel size, applied as every package of that size from the category's `delivery` attribute values.
- A category mismatch means the listing's category id is in none of the OLX suggestions. There is no score threshold. Use the existing `olx_category_mismatch` + `category_recreation` event.
- When the category check finds a mismatch in a run, attributes and delivery return `needs_human` with the reason code `category_first`, and make no proposals and no writes.
- Without a live OLX listing the three checks are out of scope and are removed from the combined verdict. `VerdictCheckStatus` gets no new value.
- Graph state and logs hold no seller or Hermes free text, only codes, ids and app-authored messages.
- Hermes calls go to the `marketdesk` no-tools profile and are attributed to the `verdict` feature. A Hermes answer outside the allowed list is dropped.
- Migrations replay on every start: anything added is idempotent; no `DROP`.
- Only the app refreshes OLX tokens. Tests and probes never do.
- Behaviour tests are live q4j tests on a branch stand. Jest only for pure rules, prompt parsers and the adapter (precedent: PR 501, PR 515).

## Review Focus

1. **A seller attribute set by hand survives a later MarketDesk price change.** This is the original bug. The adapter test in Task 1 and the live test in Task 8 both pin it.
2. **A label that is a substring of another word must not match** (`type: "LED"` inside "SOLED", brand "Apple" inside "Pineapple"). Two labels matching means no verifiable value. Pinned by the rules tests in Task 2.
3. **A retried verdict run, or two runs back to back, never writes twice.** The second run sees the values already set and the idempotency key already used. Pinned in Task 6 (graph) and Task 8 (live: a second verdict makes no second `PUT`).
4. **The public advert page is unreachable or unparseable** → delivery `needs_human` with `probe_failed`, never `ready`. Pinned in Tasks 3 and 6.
5. **A listing that stops being live keeps no stale category, attributes or delivery result blocking `overall`.** Pinned in Task 6 (combine drops them).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/backend/infrastructure/adapters/OLXAdapter.ts` (modify) | Part 1 merge; catalogue methods; stateful stub for adverts, categories and attributes |
| `src/backend/domain/services/MarketplaceAdapter.ts` (modify) | Optional `OlxCatalogue` methods on `IMarketplaceAdapter` |
| `src/backend/domain/services/advertCompletenessRules.ts` (create) | Pure rules: attribute matching, check results, package-by-size, category verdict |
| `src/backend/infrastructure/external/olxAdvertPage.ts` (create) | Parse `ad.delivery.rock.mode` from an advert page |
| `src/backend/infrastructure/external/OlxSearchPageClient.ts` (modify) | `advertDeliveryMode(url, signal)` through the shared gate |
| `src/backend/application/ports/IOlxSearch.ts` (modify) | `IOlxAdvertPage` port |
| `src/backend/infrastructure/external/advertFieldPrompts.ts` (create) | Hermes prompts and strict parsers for attribute values and parcel size |
| `src/shared/types/index.ts` (modify) | Check names, event types, `attributes`/`delivery` changes |
| `src/backend/domain/entities/HermesEvent.ts` (modify) | Type ↔ change validation |
| `src/backend/application/services/AdvertFieldsService.ts` (create) | Resolve adapter, merged update, re-read; used by the check and by approval |
| `src/backend/application/services/CategoryMismatchProposals.ts` (create) | `olx_category_mismatch` event builder, extracted from `MarketplaceImportService` |
| `src/backend/application/usecases/ApproveHermesEventUseCase.ts` (modify) | Apply `attributes` and `delivery` |
| `src/backend/application/services/verdict/olxAdvertSnapshot.ts` (create) | Per-run lazy loader shared by the three checks |
| `src/backend/application/services/verdict/{category,attributes,delivery}CheckGraph.ts` (create) | The three check subgraphs |
| `src/backend/application/services/verdict/SaleVerdictGraph.ts`, `SaleVerdictRuns.ts`, `domain/services/saleVerdictRules.ts`, `presentation/http/validation/schemas.ts`, `controllers/HermesController.ts`, `config/di/container.ts` (modify) | Wiring, scope, combine |
| `src/frontend/components/products/verdictDisplay.ts`, `product-detail/hermes/{ChecksTab.tsx,hermesCardModel.ts,hermesHistory.ts}` (modify) | Labels and order |
| `test-automation/...` (create/modify) | Live API and UI tests, MockServer advert page and Hermes answers |
| `docs/graph-testing-plan.md`, `docs/olx-real-api-readiness.md` (modify) | Checks table, hand checks after deploy |

---

## Part 1 — its own PR, branch `fix/olx-update-keeps-attributes` from `main`

### Task 1: Updates keep the advert's remote attributes

**Files:**
- Modify: `src/backend/infrastructure/adapters/OLXAdapter.ts` (`doUpdateListing`, `fetchDeliveryPackageIds` → `fetchRemoteAdvertState`, `buildAdvertPayload`, stub responder)
- Test: `src/backend/infrastructure/adapters/__tests__/OLXAdapter.test.ts`

**Interfaces:**
- Produces: `private fetchRemoteAdvertState(id: string): Promise<{ attributes: Array<{ code: string; value: string }>; deliveryPackageIds: Array<string | number> }>`
- Produces: `export function mergeAdvertAttributes(remote: OlxAttribute[], owned: OlxAttribute[]): OlxAttribute[]`. Remote order is kept; an owned code replaces the remote value in place; new owned codes are appended. `type OlxAttribute = { code: string; value: string }` is exported from `OLXAdapter.ts`.
- Stub becomes stateful (needed by Part 2 live tests). A module-level `stubAdverts: Map<string, { attributes: OlxAttribute[]; deliveryPackageIds: string[]; categoryId: number }>`:
  - `PUT` stores `body.attributes` and `body.ad_delivery?.delivery_package_ids ?? []`.
  - `GET /adverts/{id}` returns them.
  - An unknown id starts with `[{ code: 'state', value: 'used' }, { code: 'brand', value: 'sandbox-seller-brand' }]`, no packages, `categoryId: 0`.
  - `fetchRemoteAdvertState` no longer short-circuits on `usesStubTransport`.

- [ ] **Step 1: Write the failing regression test** `it('keeps attributes the seller set on OLX when updating an advert')`. The GET returns `attributes: [{code:'state',value:'new'},{code:'brand',value:'apple'},{code:'type',value:'dokanalowe'}]` and packages `['pkg-s-1']`; `updateListing('olx-1', { price: 299 }, publishInput)` with `realConfig` (condition code `state`, product condition `used`). Assert:

```ts
expect(body.attributes).toEqual([
  { code: 'state', value: 'used' },
  { code: 'brand', value: 'apple' },
  { code: 'type', value: 'dokanalowe' },
]);
expect(body.ad_delivery).toEqual({ delivery_package_ids: ['pkg-s-1'] });
```

  Add the comment "Regression guard: PUT replaces the whole advert, so an update sending only the condition wiped every attribute the seller set on OLX." Change the existing assertion at `OLXAdapter.test.ts:890` only if the merge alters it (its GET has no attributes, so it should stay `[{ code: 'state', value: 'used' }]`).
- [ ] **Step 2: Run it and see it fail:** `npx jest src/backend/infrastructure/adapters/__tests__/OLXAdapter.test.ts -t "keeps attributes"`. Expected: FAIL, received `[{ code: 'state', value: 'used' }]`.
- [ ] **Step 3: Implement** `fetchRemoteAdvertState` and `mergeAdvertAttributes`. `doUpdateListing` sets `body.attributes = mergeAdvertAttributes(remote.attributes, body.attributes ?? [])` when the result is non-empty; `ad_delivery` behaviour is unchanged. Add the stateful stub.
- [ ] **Step 4: Run the adapter suite:** `npx jest src/backend/infrastructure/adapters --forceExit`. Expected: all pass. Then `npm run type-check` and `npm run lint`, clean.
- [ ] **Step 5: Run the live suite on a branch stand** (memory: isolated Compose stand, JDK 21; `SKIP_REDIS_TESTS` not needed). `scripts/ci-java-api-tests.sh`: green. The stub change must not break the import, revival or publish live tests.
- [ ] **Step 6: Commit** `fix(olx): keep the advert's attributes when MarketDesk updates it`, push, and open a PR (pull-request-authoring). The PR body notes the real-OLX hand check: after deploy, set a brand on a prod advert in OLX, change its price in MarketDesk, and confirm the brand is still there.

---

## Part 2 — branch `feat/advert-completeness-checks`, stacked on Part 1

### Task 2: Pure completeness rules

**Files:**
- Create: `src/backend/domain/services/advertCompletenessRules.ts`
- Test: `src/backend/domain/services/__tests__/advertCompletenessRules.test.ts`

**Interfaces (Produces):**

```ts
export interface OlxCategoryAttribute {
  code: string; label: string; required: boolean; multiple: boolean;
  values: Array<{ code: string; label: string }>;
}
export interface AdvertAttribute { code: string; value: string }
export type ParcelSize = 'S' | 'M' | 'L' | 'XL';
export type DeliveryMode = 'BuyWithDelivery' | 'NotEligible' | string;

export function fillableAttributes(category: OlxCategoryAttribute[], current: AdvertAttribute[]): OlxCategoryAttribute[];
export function verifiableValues(fillable: OlxCategoryAttribute[], text: { name: string; description: string }): AdvertAttribute[];
export function containsWholeWord(haystack: string, label: string): boolean;
export function attributesCheck(input: {
  category: OlxCategoryAttribute[]; current: AdvertAttribute[]; proposalOpen: boolean; now: Date; eventIds: string[];
}): VerdictCheck;
export function categoryCheck(input: { listingCategoryId: string; suggestionIds: string[]; now: Date; eventIds: string[] }): VerdictCheck;
export function deliveryCheck(input: {
  mode: DeliveryMode | null; packageIds: string[]; categoryOffersDelivery: boolean; proposalOpen: boolean; now: Date; eventIds: string[];
}): VerdictCheck;
export function packagesForSize(deliveryAttribute: OlxCategoryAttribute, size: ParcelSize): string[];
export function categoryFirstCheck(check: 'attributes' | 'delivery', now: Date): VerdictCheck;
export function attributeIdempotencyKey(listingId: string, values: AdvertAttribute[]): string; // sha256 over listingId + sorted code=value
```

Reason codes, with fixed English copy written next to them:
- `attributes_empty_required` — "Fill the required OLX field: {label}"
- `attributes_still_empty` — "Still empty on OLX: {label}"
- `attributes_proposed` — "Hermes proposed values for empty OLX fields"
- `attribute_dropped` — "OLX did not keep {label}"
- `category_mismatch` — "OLX suggests another category for this title"
- `delivery_off` — "Buyers cannot order with Przesyłka OLX"
- `delivery_not_offered` — "OLX does not offer delivery on this advert although packages are set; check it in OLX"
- `delivery_unavailable_in_category` — "This OLX category has no delivery; fix the category first"
- `category_first` — "Fix the OLX category first"
- `probe_failed` — "Could not read the advert page on OLX"

Status rules are as in the spec: attributes `fix` while a proposal is open → `needs_human` on an empty required attribute → `ready`; delivery `BuyWithDelivery` → `ready`, mode `null` → `needs_human`/`probe_failed`.

- [ ] **Step 0: Widen the check names.**
  - In `src/shared/types/index.ts`: `VerdictCheckName = 'info' | 'price' | 'photos' | 'category' | 'attributes' | 'delivery'`, and `VerdictCheck.refs` gains `missingAttributes?: string[]; deliveryMode?: string | null`.
  - Fix the compile errors this causes in the frontend `Record<VerdictCheckName, …>` maps by adding the labels "Category", "Attributes", "Delivery":
    - `verdictDisplay` order `['info','price','photos','category','attributes','delivery']`;
    - `hermesCardModel` and `hermesHistory` order `['price','info','photos','category','attributes','delivery']`;
    - `ChecksTab` rows with the same titles.
  - In `SaleVerdictGraph`, `CHECK_NAMES` stays `['info','price','photos']` until Task 6.
  - `npm run type-check` must be clean.
- [ ] **Step 1: Write the failing tests.** Copy the spec's values exactly:
  - `verifiableValues` picks `brand: apple` for "Apple AirPods 4 MXP63ZM/A, etui USB-C" when the values are `[{code:'apple',label:'Apple'},{code:'samsung',label:'Samsung'}]`.
  - It returns `[]` for "Pineapple case" (Review Focus 2).
  - It returns `[]` when "Apple Samsung" matches two labels.
  - It matches "Projektor LED" against label `LED`, but not "SOLED".
  - Diacritics: "obrotów" matches label "obrotow".
  - `fillableAttributes` skips set codes, `delivery`, `multiple: true` and empty `values`.
  - `attributesCheck` with an empty `state` (required) → `needs_human`. With only an empty optional `bdo` → `ready` plus an `attributes_still_empty` reason. With `proposalOpen` → `fix`.
  - `categoryCheck('5091', ['1234','5678'])` → `fix` plus `category_mismatch`. With `'1984'` among the suggestions → `ready`.
  - `deliveryCheck`:
    - `NotEligible` with packages `['a']` → `needs_human` + `delivery_not_offered`;
    - `NotEligible`, no packages, the category offers delivery → `fix` + `delivery_off`;
    - the category does not offer delivery → `fix` + `delivery_unavailable_in_category`;
    - `null` → `needs_human` + `probe_failed`.
  - `packagesForSize` with the 14 production labels (spec, category 1984) and size `S` → the 4 S ids, in this order: `ef5414d2-…` (InPost Paczkomat S), `e6a8e063-…` (Poczta Polska S), `8987b2c9-…` (InPost Kurier S), `13b03e04-…` (DPD Kurier S). The size is the label's last token.
  - `attributeIdempotencyKey` does not depend on the order of the values.
- [ ] **Step 2: Run them and see them fail:** `npx jest src/backend/domain/services/__tests__/advertCompletenessRules.test.ts`. Expected: FAIL, "Cannot find module".
- [ ] **Step 3: Implement** in `advertCompletenessRules.ts`. Normalize text with `normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()`. A word boundary is `(?<![\p{L}\p{N}])label(?![\p{L}\p{N}])` with the label regex-escaped. The module imports only `shared/types` and `crypto`.
- [ ] **Step 4: Run them and see them pass.** Same command: PASS. Then `npm run type-check`.
- [ ] **Step 5: Commit** `feat(verdict): advert completeness rules`.

### Task 3: OLX catalogue on the adapter, advert-page delivery reader

**Files:**
- Modify: `src/backend/domain/services/MarketplaceAdapter.ts`, `src/backend/infrastructure/adapters/OLXAdapter.ts`, `src/backend/application/ports/IOlxSearch.ts`, `src/backend/infrastructure/external/OlxSearchPageClient.ts`
- Create: `src/backend/infrastructure/external/olxAdvertPage.ts`
- Test: `OLXAdapter.test.ts`, `src/backend/infrastructure/external/__tests__/olxAdvertPage.test.ts`

**Interfaces:**
- Consumes: `OlxCategoryAttribute`, `AdvertAttribute` (Task 2); `mergeAdvertAttributes`, `fetchRemoteAdvertState` (Task 1).
- Produces, on `IMarketplaceAdapter`, all optional like `listThreads`:

```ts
categorySuggestions?(title: string): Promise<string[]>;                       // GET /categories/suggestion?q=, leaf ids as strings, OLX order
categoryAttributes?(categoryId: string): Promise<OlxCategoryAttribute[]>;   // GET /categories/{id}/attributes
advertFields?(externalListingId: string): Promise<{ categoryId: string; attributes: AdvertAttribute[]; deliveryPackageIds: string[] }>;
updateAdvertFields?(externalListingId: string, current: ListingPublishInput,
  fields: { attributes?: AdvertAttribute[]; deliveryPackageIds?: string[] }): Promise<void>;
```

`updateAdvertFields` builds the same body as `doUpdateListing` (`configuredDelivery: false`). Attributes are `mergeAdvertAttributes(remote, [...owned, ...fields.attributes])`. `ad_delivery` is `fields.deliveryPackageIds` when given, else the remote packages. The `PUT` goes through `execute('updateAdvertFields', …)`.

- Produces: `export function parseOlxAdvertDelivery(html: string): string | null` (`__PRERENDERED_STATE__` → `ad.ad.delivery.rock.mode`, zod-validated).
- Produces: `export interface IOlxAdvertPage { deliveryMode(advertUrl: string, signal: AbortSignal): Promise<string | null> }`, implemented by `OlxSearchPageClient`:
  - same gate, timeout, redirect and no-cookie rules;
  - the URL path is rebased onto `OLX_SEARCH_BASE_URL` when it is set, so the stand's MockServer serves it;
  - the result is `null` on any failure.
- Stub (Task 1 map):
  - `categorySuggestions` returns `['1984']` for titles containing "projektor" and `['5091']` otherwise;
  - `categoryAttributes` returns a fixture of `state` (required, used/new), `brand` (values Apple, AOPEN, sandbox-seller-brand), `type` (values dokanalowe, nauszne, LED), `bdo` (free text, no values), and `delivery` (four S packages and two M packages, with labels in the production format);
  - `advertFields` reads the map, with `categoryId` taken from the map or the listing.

- [ ] **Step 1: Write the failing tests.**
  - Adapter: `categoryAttributes` maps `validation.required` to `required` and `allow_multiple_values` to `multiple`.
  - Adapter: `updateAdvertFields('olx-1', input, { deliveryPackageIds: ['pkg-m-1'] })` sends `ad_delivery: { delivery_package_ids: ['pkg-m-1'] }` and keeps the remote `brand`.
  - Adapter: `updateAdvertFields` with `attributes: [{code:'type',value:'LED'}]` appends it after the remote attributes.
  - `parseOlxAdvertDelivery`: reads `BuyWithDelivery` from a minimal synthetic page, and returns `null` for a page without state (Review Focus 4).
- [ ] **Step 2: Run them and see them fail:** `npx jest src/backend/infrastructure/adapters src/backend/infrastructure/external/__tests__/olxAdvertPage.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the four adapter methods, the parser and `OlxSearchPageClient.deliveryMode`.
- [ ] **Step 4: Run them and see them pass.** Same command: PASS. Then type-check and lint.
- [ ] **Step 5: Commit** `feat(olx): category suggestion, attributes and advert field update`.

### Task 4: Hermes prompts for attribute values and parcel size

**Files:**
- Create: `src/backend/infrastructure/external/advertFieldPrompts.ts`
- Test: `src/backend/infrastructure/external/__tests__/advertFieldPrompts.test.ts`

**Interfaces (Produces):**

```ts
export function buildAttributeChoicePrompt(item: ResearchItem, attributes: OlxCategoryAttribute[]): { system: string; prompt: string };
export function parseAttributeChoices(raw: string, attributes: OlxCategoryAttribute[]): AdvertAttribute[]; // keeps only {code,value} pairs where value ∈ that attribute's value codes; one per code
export function buildParcelSizePrompt(item: ResearchItem): { system: string; prompt: string };
export function parseParcelSize(raw: string): ParcelSize | null;
```

The answer format is JSON: `{"values":{"<code>":"<value code>|null"}}` and `{"size":"S|M|L|XL"}`. `ResearchItem` comes from `researchItemFromProduct` (`priceResearchPrompts.ts`), as in the response graph.

- [ ] **Step 1: Write the failing tests.**
  - `parseAttributeChoices` drops a value outside the list, drops an unknown code, drops `null`, and returns `[]` for non-JSON or text around the JSON beyond one fenced block.
  - `parseParcelSize('{"size":"XXL"}')` → `null`; `parseParcelSize('{"size":"m"}')` → `'M'`.
  - The prompt contains every allowed value code and no description text beyond what `ResearchItem` carries.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** `feat(verdict): Hermes prompts for advert attributes and parcel size`.

### Task 5: Event types, changes, apply path

**Files:**
- Modify: `src/shared/types/index.ts`, `src/backend/domain/entities/HermesEvent.ts`, `src/backend/application/usecases/ApproveHermesEventUseCase.ts`, `src/backend/application/services/MarketplaceImportService.ts`
- Create: `src/backend/application/services/AdvertFieldsService.ts`, `src/backend/application/services/CategoryMismatchProposals.ts`
- Test: live in Task 8. The `HermesEvent` validation gets a minimal case in the existing `HermesEvent.test.ts` only to keep it compiling, if needed.

**Interfaces (Produces):**

```ts
// shared/types (VerdictCheckName and refs were widened in Task 2)
// HermesEventType adds: 'filled_advert_attributes' | 'suggested_advert_attributes' | 'suggested_delivery'
export interface AdvertAttributesChangePayload {
  kind: 'attributes'; listingId: string; values: Array<{ code: string; value: string; label: string; valueLabel: string }>;
}
export interface DeliveryChangePayload { kind: 'delivery'; listingId: string; size: ParcelSize; packageIds: string[] }
// ProposedChange adds both.

// AdvertFieldsService
export class AdvertFieldsService {
  constructor(deps: { products; listings; marketplaces; adapters: { resolve(m: Marketplace): Promise<IMarketplaceAdapter> } })
  apply(workspaceId: string, listingId: string, fields: { attributes?: AdvertAttribute[]; deliveryPackageIds?: string[] }):
    Promise<{ kept: AdvertAttribute[]; dropped: AdvertAttribute[] }>; // update, then advertFields re-read
}

// CategoryMismatchProposals: extracted from MarketplaceImportService:815-860, same event shape and idempotency key
export class CategoryMismatchProposals {
  raise(input: { workspaceId: string; product: Product; listing: Listing;
    currentCategory: MarketplaceCategoryMetadata; proposedCategory: MarketplaceCategoryMetadata | null }): Promise<HermesEvent | null>;
}
```

- `HermesEvent` validation:
  - `filled_advert_attributes` and `suggested_advert_attributes` require `kind: 'attributes'`;
  - `suggested_delivery` requires `kind: 'delivery'`.
- `ApproveHermesEventUseCase.applyChange`:
  - `case 'attributes'` → `advertFields.apply(..., { attributes })`;
  - `case 'delivery'` → `advertFields.apply(..., { deliveryPackageIds: change.packageIds })`;
  - returns `{ marketplaceUpdates: [] }`;
  - a provider error fails the approval, as the price path does.
- `MarketplaceImportService` calls `CategoryMismatchProposals.raise` instead of its inline block. Behaviour is unchanged; the existing import live tests are the guard.

- [ ] **Step 1: Make the event and change type changes** (`HermesEventType`, the two payloads, `ProposedChange`). Fix any exhaustive `switch` they break.
- [ ] **Step 2: Implement** the `HermesEvent` validation, `AdvertFieldsService`, `CategoryMismatchProposals` (move the code without changing it), and the approve cases.
- [ ] **Step 3: Verify:** `npm run type-check`, `npm run lint`, `SKIP_REDIS_TESTS=true npx jest --forceExit`. Expected: clean, all pass.
- [ ] **Step 4: Commit** `feat(verdict): advert attribute and delivery proposals`.

### Task 6: The three checks and the verdict wiring

**Files:**
- Create: `src/backend/application/services/verdict/olxAdvertSnapshot.ts`, `categoryCheckGraph.ts`, `attributesCheckGraph.ts`, `deliveryCheckGraph.ts`
- Modify: `SaleVerdictGraph.ts`, `SaleVerdictRuns.ts`, `src/backend/domain/services/saleVerdictRules.ts`, `src/backend/presentation/http/validation/schemas.ts:380`, `controllers/HermesController.ts:181`, `src/backend/config/di/container.ts`
- Test: `src/backend/application/services/verdict/__tests__/advertChecks.test.ts` (Jest, fake adapter, as the existing verdict graph tests do)

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:

```ts
export interface OlxAdvertSnapshot {
  listingCategoryId: string; title: string; externalListingId: string; externalUrl: string | null;
  attributes: AdvertAttribute[]; deliveryPackageIds: string[];
  categoryAttributes: OlxCategoryAttribute[]; suggestionIds: string[];
  categoryMismatch: boolean;
}
// CheckContext gains: olx: (() => Promise<OlxAdvertSnapshot>) | null   — memoized, null without a live OLX listing
export function liveOlxScope(scope: VerdictCheckName[], hasLiveOlx: boolean): VerdictCheckName[];
export function combineVerdict(fresh: VerdictCheck[], previous: VerdictChecks, drop?: VerdictCheckName[]): {...}; // drop removes stored checks
export function buildCategoryCheck(deps: { proposals: CategoryMismatchProposals; taxonomy: { verify(id: string): Promise<MarketplaceCategoryMetadata> } }): CheckGraph;
export function buildAttributesCheck(deps: { fields: AdvertFieldsService; events: IEventRepository; hermes: AITextCompletionClient | null; idFactory: IdFactory }): CheckGraph;
export function buildDeliveryCheck(deps: { page: IOlxAdvertPage; events: IEventRepository; hermes: AITextCompletionClient | null; idFactory: IdFactory }): CheckGraph;
```

Each check's nodes:

| Check | Nodes | Notes |
|---|---|---|
| category | `load → judge → propose? → result` | `propose` only on a mismatch: `taxonomy.verify(suggestionIds[0])` (null on failure), then `proposals.raise` |
| attributes | `load → categoryGate → match → write? → reread → hermes? → result` | see below |
| delivery | `load → categoryGate → page → propose? → result` | see below |

- **attributes:**
  - `write` runs only when there are verifiable values, through `events.saveRecommendationIfAbsent(event, attributeIdempotencyKey(...))`. If the insert returned null, the write is skipped (Review Focus 3).
  - On a successful insert: `fields.apply(...)`, then the event is saved as `filled_advert_attributes`, `status: 'applied'`, `autonomyDecision: 'auto_apply'`, title "Filled {label}: {valueLabel} (found in the title)" (or "…in the description").
  - `hermes` runs only on the still-empty fillable attributes, and saves `suggested_advert_attributes` as `pending_review`, superseding the product's earlier pending ones.
- **delivery:** `propose` runs only for `delivery_off`. It calls Hermes for the size → `packagesForSize` → a `suggested_delivery` event (`pending_review`). With no Hermes or an unusable answer, no proposal is made and the check stays `fix` with its reason.
- **Routing:**
  - `SaleVerdictGraph` adds the three nodes.
  - `load` builds `ctx.olx` only for a listing with `isLive()`, a `marketplaceListingId`, and an adapter offering `advertFields`.
  - `run` applies `liveOlxScope`, and passes `drop = ['category','attributes','delivery']` to `combine` when `ctx.olx` is null (Review Focus 5).
  - The default scope in `HermesController` and the zod enum (`max(6)`) include the three.
  - The `SaleVerdictGraph` deps gain `adapters` for the snapshot loader. Container: `existingAdvertAdapters`, `HermesCompletionClient(hermesQueryConfig, aiUsageSink)` (the same no-tools profile as the response graph), and `OlxSearchPageClient` as `IOlxAdvertPage`.

- [ ] **Step 1: Write the failing graph tests** (fake adapter, fake page, fake Hermes):
  - mismatch → category `fix`, one `olx_category_mismatch` event; attributes and delivery `needs_human`/`category_first`; no `updateAdvertFields` call;
  - a verifiable `brand` → one `updateAdvertFields` call with `[{code:'brand',value:'apple'}]` and one applied `filled_advert_attributes` event;
  - running the same graph twice → still one call (Review Focus 3);
  - the re-read drops `brand` → reason `attribute_dropped`, not counted as filled;
  - page `null` → delivery `needs_human`/`probe_failed` (Review Focus 4);
  - Hermes size `M` → a `suggested_delivery` event with exactly the two M package ids;
  - a product whose listing is not live → the three are absent from `scope`, and a stored delivery `fix` from before is dropped, so `overall` is computed without it (Review Focus 5).
- [ ] **Step 2: Run them and see them fail:** `npx jest src/backend/application/services/verdict`. Expected: FAIL.
- [ ] **Step 3: Implement** the snapshot, the three checks, the routing, the combine `drop`, the scope and the container wiring.
- [ ] **Step 4: Run** `SKIP_REDIS_TESTS=true npx jest --forceExit`, type-check and lint. Expected: all pass.
- [ ] **Step 5: Commit** `feat(verdict): category, attributes and delivery checks`.

### Task 7: Hermes card shows the new checks and events

**Files:** `src/frontend/components/product-detail/hermes/ChecksTab.tsx`, `hermesCardModel.ts`, `hermesHistory.ts`, `src/frontend/components/products/verdictDisplay.ts`, plus the event title display if it switches on `HermesEventType`.

- [ ] **Step 1:** Labels and order are already in from Task 2. Make sure:
  - an `applied` `filled_advert_attributes` event renders in the history as an AI change, with no Approve button;
  - `suggested_advert_attributes` and `suggested_delivery` render with Approve and Dismiss like the price proposals;
  - the delivery proposal's detail shows the size and the carrier labels.
- [ ] **Step 2:** `SKIP_REDIS_TESTS=true npx jest src/frontend --forceExit`, type-check, lint: clean.
- [ ] **Step 3: Commit** `feat(products): show category, attributes and delivery checks`.

### Task 8: Live tests

**Files:**
- Create: `test-automation/src/test/java/dev/quokkify/marketdesk/test/api/AdvertCompletenessTest.java`, `test/ui/AdvertCompletenessUiTest.java`
- Modify: `VerdictSteps` (and its verification), `HermesMockSteps` (Hermes answers keyed by product name for the attribute and size prompts; an advert page per advert id with a given `rock.mode`), `ListingSteps`/`DatabaseHelper` (seed `external_url` on the live listing), `ProductRequestPojo` samples
- Modify: `scripts/ci-java-api-tests.sh` only if the MockServer needs a new path family (`/d/oferta/*`).

The tests run in OLX stub mode. They use `markLiveOnOlx` plus a seeded `external_url` on the stand's `OLX_SEARCH_BASE_URL` host.

Test cases:
- `verifiableBrandIsFilledOnce`:
  - product title "Apple AirPods sandbox <unique>", which has no "projektor", so the stub suggests `5091`;
  - the listing category is seeded to `5091` through the DB seam, so the category check is `ready`;
  - the verdict shows attributes `ready` or with an empty-optional reason, and one applied event "Filled brand: Apple";
  - a second verdict adds no second event (Review Focus 3).
- `sellerAttributeSurvivesPriceChange` (Review Focus 1):
  - the stub advert starts with `brand: sandbox-seller-brand`;
  - change the price through the existing price API, then run the verdict;
  - attributes has no `attributes_still_empty` reason for brand, and no event touches brand.
- `categoryMismatchBlocksTheOtherChecks`: a "projektor" title in category `5091` → category `fix` plus an `olx_category_mismatch` event; attributes and delivery `category_first`.
- `deliveryOffGetsSizeProposal`:
  - advert page `NotEligible`, no packages, Hermes size `M`;
  - → delivery `fix`, a `suggested_delivery` event;
  - approve it → the next verdict reads page `BuyWithDelivery` (switch the mock), and delivery `ready`.
- `unreadablePageIsProbeFailed`: MockServer 500 → delivery `needs_human`/`probe_failed`.
- UI test: the Hermes card's Checks tab shows the rows "Category", "Attributes", "Delivery" with their statuses for a seeded product.

- [ ] **Step 1: Write the tests and steps.**
- [ ] **Step 2: Run them RED** on a stand built from the Task 5 commit: the new checks don't exist yet, so `verifiableBrandIsFilledOnce` fails on the missing `attributes` check.
- [ ] **Step 3: Run them GREEN** on a stand from the branch head: `scripts/ci-java-api-tests.sh` (JDK 21) → BUILD SUCCESSFUL, every existing test still green. Restore the three tracked screenshots if a visual run rewrote them.
- [ ] **Step 4: Commit** `test(verdict): live tests for advert completeness checks`.

### Task 9: Docs and hand checks

**Files:** `docs/graph-testing-plan.md` (the verdict row gains three checks and their edges), `docs/olx-real-api-readiness.md` (new real-OLX hand checks).

Real-OLX hand checks after deploy:
1. AirPods: is `brand: Apple` filled, and does a second run make no second write?
2. Projector: is `brand: AOPEN` filled?
3. Nail drill: is there a category proposal?
4. AirPods delivery: `needs_human` with "check in OLX".
5. A price change keeps the attributes.

- [ ] **Step 1: Write the doc changes.**
- [ ] **Step 2: Commit** `docs: advert completeness checks`, push, and open a PR stacked on Part 1 (pull-request-authoring). The PR body lists the hand checks above as the post-deploy test plan.
