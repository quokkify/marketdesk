# Photo to advert: design

Status: approved by the owner, 2026-11-13.
Follows `2026-11-13-cut-to-core-design.md` (follow-up project "Build the loop") and concept
issue #290.

## 1. Intent

The seller drops photos of an item and lands on one review screen where the title, description,
condition, price and exact OLX category are already filled in. One confirmation queues the
advert. Today the same path takes 19 required seller actions across 8 screens, and the "AI
draft" fills none of the fields the seller has to type.

Why now: the stage goal is selling on autopilot. Appendix A of the cut-to-core design lists
"the model never sees photos" and "a human chooses the OLX category" as the first two blockers.
Later projects (the agent keeps working on a live advert, market-based pricing, buyer replies)
have little to work on while getting an advert out is this slow.

Evidence, stated honestly: no vendor publishes a number showing that AI-written listings sell
more often. What is measured is seller effort: Poshmark reports 48% less listing time, OLX Group
reports 11 percentage points more completed postings. This project is judged on seller effort
and on draft accuracy, not on sell-through.

## 2. Goals, non-goals, anti-goals

**Goals**

- G1. From "New product" to a queued advert in about 5 seller actions when the draft is right:
  open, pick photos, (wait), review, confirm.
- G2. Without any AI (Hermes offline or the draft failed) the same path takes about 8 actions
  and never dead-ends.
- G3. The model receives the photos and returns title, description, condition, a price
  estimate and search terms for the OLX category.
- G4. The server preselects an exact, taxonomy-verified OLX leaf category; the seller sees its
  full path and can change it.
- G5. Draft quality is measurable: a fixture set and a scored run exist before the feature is
  called done.

**Non-goals** (each is a later project)

- Publication with no human confirmation.
- Prices from comparable adverts or from past sales.
- Changing a live advert, scheduled agent runs, sale detection.
- Buyer messages.
- OLX category attributes and location beyond what the publish payload carries today.
- A model-driven tool loop (`createAgent`). The steps here are known in advance.
- Durable checkpoints. The graph stays stateless between requests.

**Anti-goals** (the feature has failed if any of these happens, even if it works)

- A wrong draft is easier to publish than to notice. Every AI-filled field is marked as such
  and editable in place.
- A heuristic or placeholder is presented as model output.
- The draft invents a brand, model or defect-free condition the photos do not show.
- A price of 0, or a missing category, reaches the publish step.
- Anything read from a photo (text on a label, a screenshot with instructions) changes what
  the system does rather than what the draft says.

## 3. Constraints

- **Hermes is an agent endpoint, not a bare model.** Its API server accepts `image_url` parts
  (http(s) and `data:image/...`) on `/v1/chat/completions`. It runs its own server-side tools
  and returns a final answer. Client-supplied tools and `response_format` are not documented.
  All of this is from documentation; no live request has been made (section 8, step 0).
- The app runs in Docker and Hermes runs natively on the host, so Hermes cannot be assumed to
  reach the app's upload URLs. Images travel as `data:` URIs.
- The existing completion timeout is 30 s (`HERMES_REQUEST_TIMEOUT_MS`). A vision call with
  several images may need its own, longer limit.
- `OlxTaxonomyResolver.search` matches a 2 to 80 character substring against leaf names and
  returns at most 20 leaves; `verify` returns metadata with `source: 'provider_taxonomy'` and
  confidence 1. `evaluateOlxCategory` stays the authority and is not relaxed.
- `docs/publication-journey-graph.md` requires the seller to confirm the exact category. That
  rule stays; the single confirmation on the review screen satisfies it because the screen
  shows the full category path.
- Every publish call re-runs the server preflight. Nothing in the browser grants permission.
- No migration unless section 7 proves one is needed; migrations replay on every start.
- The repository is public: no employer data, hosts or tokens in fixtures or docs.
- Node 22 or later is already required by `package.json`, which the LangChain v1 packages need.

## 4. Approaches

| | Approach | Trade-off |
| --- | --- | --- |
| 1 | Add image parts to the existing `HermesCompletionClient`; add steps to the current graph. | No new dependency and certain to work with Hermes. Adds nothing from LangChain, and the model layer has to be redone for later projects. |
| 2 | **Chosen.** Code-defined steps in LangGraph; the model is reached through LangChain's chat-model layer (`ChatOpenAI` with a custom `baseURL` pointing at Hermes): standard image content blocks, a scripted fake model in tests, evaluators from `openevals`. | Two or three new dependencies. Whether Hermes honours structured-output requests is unverified, so Zod parsing of a JSON answer stays as the guaranteed path. The provider becomes a one-line swap and the layer is reused by later projects. |
| 3 | `createAgent` with tools for category search and attributes. | Most flexible. Needs a tool-calling model reached around Hermes (new provider, new key), is harder to test and widens the injection surface for no gain while the steps are fixed. |

The owner chose approach 2 on 2026-11-13. If step 0 shows that `ChatOpenAI` cannot talk to
Hermes at all, the fallback is approach 1 behind the same port; nothing else in this design
changes.

## 5. What the seller sees

```text
[ New product ]
      |
      v
+-------------------------------+
| Add photos                    |   one screen; phone camera or gallery
| [ + ]  [img] [img] [img]      |
|                 [ Continue ]  |
+-------------------------------+
      |  draft runs (progress text, cancellable, about 10-40 s)
      v
+---------------------------------------------+
| Review and publish                           |
| Title        [ IKEA Poang armchair, birch ] *|   * = filled by AI
| Description  [ ...                        ] *|
| Condition    [ Good v ]                     *|
| Price, PLN   [ 180 ]  estimate, low confidence *
| OLX category Dom i Ogrod > Meble > Fotele   *|   [ Change ]
| Notes from the draft: "back cushion not shown"|
|                                              |
| [ Save as draft ]      [ Publish to OLX ]    |
+---------------------------------------------+
      |
      v
  product saved -> listing created -> category saved -> preflight -> queued
  status shown and refreshed until the advert is live or has failed
```

- The six-step wizard becomes two screens: photos, then review. The generic six-button category
  step, the single-option marketplace step and the separate wizard review disappear.
- SKU is generated by the server and is no longer asked for. It stays editable on the product
  page.
- The marketplace defaults to the only connected one. With none connected, the review screen
  offers "Save as draft" and a "Connect OLX" link; the wizard draft already survives the detour.
- Price must be above 0 to publish. An empty or zero price disables "Publish to OLX" with the
  reason next to the field.
- If the draft fails or Hermes is offline, the review screen opens with empty fields and a
  one-line reason. The category picker is seeded with the title as the seller types it.
- "Change" opens the existing category search, seeded with the current title, searching as the
  seller types and saying "no matches" when there are none. The numeric category ID input
  moves behind an "advanced" disclosure.
- Blockers that only the publication preflight can find (quota, OAuth expiry) need a listing,
  which exists only after the product is created. When the preflight finds one, the existing
  review dialog opens on the product page with the existing override controls; they are not
  redesigned here. With no blocker the advert is queued without that dialog.
- After queueing, the product page polls the listing while its status is pending and shows a
  failure in place.
- The file input keeps the phone's own picker, which offers both camera and gallery (a
  `capture` attribute would force the camera and hide the gallery); one unsupported file is skipped with a message
  instead of rejecting the whole selection; the review screen is full-screen at phone width
  with the publish button reachable without scrolling past secondary content.

## 6. How it works

### 6.1 Flow

```text
POST /api/products/ai-draft { mode: 'photos', imageIds }
  load images (workspace-scoped) -> downscale -> vision draft -> validate
    -> search taxonomy with each proposed term -> choose a leaf (model, from candidates only)
    -> verify leaf -> assemble draft
```

The flow is a LangGraph graph with one node per arrow, observed through the same
lifecycle-only observer that `ProductAssistanceGraph` uses, so the experiment harness can
record it. Whether it is a new graph or a replacement of the `draft` route inside
`product-assistance` is left to the builder; either way the version identifier changes.

### 6.2 Model layer

- A new domain port, separate from `IAIProvider`, with two operations: describe an item from
  images, and choose one category from a given candidate list. The existing `IAIProvider`
  methods are untouched.
- Its adapter wraps a LangChain chat model built from the existing Hermes settings
  (`HERMES_API_URL`, `HERMES_API_KEY`, `HERMES_MODEL`). Credentials stay in the adapter and
  never enter graph state, as today.
- Output is always validated by a strict Zod schema on our side. Native structured output is
  used only if step 0 shows Hermes honours it; otherwise the schema is stated in the prompt, as
  `HermesCompletionClient` does today.
- Routing follows `HERMES_PROVIDER_MODE` and the health probe exactly like
  `AIProviderSelector`. In offline mode there is no photo draft: no heuristic stands in for
  vision.
- LangSmith tracing stays disabled by default in every entry point that loads the model layer.

### 6.3 Images

- The wizard already uploads photos before the product exists, and each upload is a file under
  the workspace's own storage path (`/uploads/workspaces/<key>/products/<uuid>.<ext>`). The
  request names those uploads; the server resolves each one to a file inside the caller's
  workspace directory and reads it from disk. A reference that does not resolve there is
  rejected. The server never fetches a URL on the model's or the browser's say-so. No new
  storage endpoint is needed.
- Each image is downscaled with `sharp` (already a dependency) and re-encoded before it is
  sent, which also strips metadata such as location. At most a fixed number of images is sent,
  cover first. The exact limits are set after step 0 measures latency and are configuration.

### 6.4 Draft contract

The photo draft returns, each with its own "uncertain" flag:

- title, description (within the product form's existing length rules), condition;
- price estimate in PLN with a low and high bound and a confidence level; absent when the model
  declines to estimate, never 0;
- up to five OLX category search terms in Polish (internal, not shown);
- the verified OLX leaf: provider id, name, full path; absent when no candidate fits;
- what the photos do not show and the seller should check (free text, a few short lines);
- source and model identification, so the UI can label the draft.

The model is told to describe only what is visible, to leave brand or model empty rather than
guess, and to list visible defects. The generic `product.category` value is derived by the
server from the chosen OLX path instead of being asked for.

### 6.5 Category choice

The model never emits a category id on its own. It proposes search terms; the server runs
`search` for each and merges the leaves; the model then picks one id out of that list or
declines; the server rejects any id that is not in the list and calls `verify` on the pick.
`evaluateOlxCategory` runs in the publication preflight as it does now, including its lexical
contradiction check.

### 6.6 Trust boundary

- Photos are untrusted input: text inside an image is content to describe, never an instruction.
- Our side of the boundary is safe by construction: the model's answer can only become the
  fields in 6.4, the category must come from our candidate list, nothing is saved or published
  without the seller's confirmation, and the publication preflight is unchanged.
- Hermes's side is not ours: it runs server-side tools (terminal, files, search) under its own
  configuration, and an instruction hidden in a photo could address those. Step 0 must
  establish whether the API server can run with those toolsets off. If it cannot, the owner
  decides after the spike whether to accept that risk or to point the photo draft at a bare
  vision model. That decision does not block step 2: the photo-draft model has its own
  endpoint, key and model settings, which default to the Hermes values, so the switch is
  configuration and the port hides it from the graph.
- Photos leave the server for Hermes and its model provider, as product text already does.

### 6.7 Publishing from the review screen

"Publish to OLX" performs, through existing endpoints and in order: create product, create
listing draft with the reviewed price, save the verified category, fetch the publication
preview, queue publication. A failure at any step leaves the product saved and shows which step
failed and what to do; the seller can retry from the product page as today.

The sequence is driven by the browser, with no new server-side idempotency store and no
migration. Product creation is the only step that is not already repeatable: the browser keeps
the created product id in the saved wizard draft and a retry resumes after it. Listing creation
already finds or creates one draft per product and marketplace, and saving the category,
previewing and queueing are safe to repeat (queueing is fenced by the existing operation id).

## 7. Proof

- **Unit and graph tests** run with a scripted fake chat model: no network, deterministic.
- **Offline experiment** (`npm run experiment:assistance` or a sibling command) gains photo-draft
  cases through fixture model responses: a normal item; an item the model cannot identify; a
  response naming a category id outside the candidate list; a response with price 0 or negative;
  instruction-like text returned as "seen in the photo"; a foreign workspace's image id; model
  failure. All must end review-only with domain entities unchanged.
- **Real-model evaluation**, run by hand against the owner's Hermes and never in CI: a small set
  of the owner's own item photos with expected leaf category, key title terms and a plausible
  price range. Scored deterministically (category exact match, terms present, price inside the
  range) and reported as a table. The photos stay outside the repository.
- **Seller effort**: the Playwright publication-journey spec is updated to the new path and
  counts as the proof of G1 and G2.
- The cut-to-core "core-loop proof" tests keep passing unchanged, except where a test encodes
  the removed wizard steps.

Done means: G1 and G2 shown by the browser spec; the offline experiment gate green; a
real-model evaluation table attached to the pull request with the owner's verdict on it.

## 8. Delivery

Each step is one pull request into `main`.

| Step | Scope | Depends on |
| --- | --- | --- |
| 0 | Spike against the owner's Hermes, throwaway script: does a `ChatOpenAI` client connect; image in and JSON out; does native structured output work; latency for 1, 3 and 6 images; can server-side toolsets be off for the API server. Outcome recorded in this document. | Owner access to Hermes |
| 1 | Flow without AI: two-screen wizard, server SKU, default marketplace, price above 0, seeded category search with search-as-you-type, publish from the review screen, status polling, phone fixes. | Nothing; can start before step 0 |
| 2 | Model layer, image pipeline, photo draft contract and graph, review screen prefill with AI marking, offline experiment cases. | Step 0 |
| 3 | Category preselection (terms, candidates, choice, verify) and the real-model evaluation. | Step 2 |

Step 0 is a script written by the builder and run where Hermes is reachable; it prints a short
result table and sends one synthetic test image, no seller data. "Go" for approach 2 means a
`ChatOpenAI` client gets a parseable JSON answer about the image within the chosen timeout.
Anything less is the approach 1 fallback behind the same port. The implementation plan writes
steps 2 and 3 so that only the adapter differs between the two outcomes.

Rollback is a revert of the step's commit. Step 1 removes UI only; no stored data changes.

## 9. Decisions

**Decided by the owner (2026-11-13)**

- Start with photo to advert, ahead of the agent that works on live adverts, market pricing and
  buyer replies.
- Build it as code-defined steps with a LangChain model layer (approach 2).
- This design, including the calls listed below.
- Step 0: the builder writes the spike script, the owner runs it where Hermes is reachable and
  returns the result table. The Hermes key stays in the owner's environment.

**Calls made in this design** (the owner may overrule any of them)

- One human confirmation stays; no zero-touch publication in this project.
- The price is a model estimate from photos, marked as low confidence, with no market data.
- No photo draft when Hermes is offline; the manual form is the fallback.
- The existing `title`-mode draft and the `IAIProvider` methods are left as they are.
- SKU is server-generated and hidden from the creation path.
- The generic six-category step is removed and `product.category` is derived.
- Images are sent as downscaled `data:` URIs by identifier, not by URL.
- The real-model evaluation uses the owner's own photos and is not committed: 10 to 15 items
  the owner has sold or would sell, each with the category and price the owner considers right.
- A low-confidence price is marked next to the field and nothing more: no forced edit and no
  extra acknowledgement.
- Publishing from the review screen is a browser-driven sequence with no new stored
  idempotency key (section 6.7).
- The photo-draft model has its own settings that default to the Hermes values (section 6.6).
- Step 1 updates the visual test and its tracked screenshots if they show the removed steps.
- Step 1 alone reaches about 10 seller actions, not the 8 of G2: typing a category word and
  picking the leaf are two actions, and "Continue" is one. Step 3 removes the category pair.
- Measured for step 1 in `tests/visual/publication-journey.spec.ts`: 10 seller actions from
  "New product" to "Publish to OLX".
- The misleading AI draft panel leaves the wizard in step 1; the photo draft of step 2
  replaces it. The `title`-mode endpoint stays.
- Step 1 ships before the AI steps so the flow improves even if step 0 goes badly.
- Improvement suggestions that must be retyped, the quota override wording and the OAuth
  return path stay as they are.

## 10. Left to the builder

- Exact package set and versions for the model layer, checked against current documentation
  rather than memory (the fake model and the evaluators determine which packages are needed).
- New graph versus a new route in `product-assistance`, and the version identifiers.
- The request and response shapes of the draft endpoint and whether `title` mode shares them.
- Image limits (count, pixel size, quality) and the vision timeout, from step 0 measurements.
- Prompt wording, kept in the versioned agent catalogue next to `listing-seo`.
- One orchestrating publish endpoint versus a browser-driven sequence (section 6.7).
- How the SKU is generated so that it is unique per workspace.
- Which documents each step makes untrue (`docs/publication-journey-graph.md`,
  `docs/TESTING_GUIDE.md`, `docs/spec` traceability rows) and their updates in the same pull
  request.

## Appendix A. Sources

- Seller-flow review of the current code, 2026-11-13: 19 required actions (14 clicks, 5 typed
  inputs), category asked twice, price 0 accepted by the wizard and rejected at publication
  (`src/backend/application/usecases/PublishListingUseCase.ts:64-67`), photo draft fields
  (`src/backend/application/services/ProductAIDraftService.ts:183-194,225-238`).
- Hermes API server: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server
- LangChain JS: https://docs.langchain.com/oss/javascript/langchain/messages.md,
  https://docs.langchain.com/oss/javascript/integrations/chat/openai.md,
  https://docs.langchain.com/oss/javascript/langchain/structured-output.md,
  https://docs.langchain.com/oss/javascript/langchain/test/unit-testing.md
- Prior art: eBay photo-to-listing, Mercari AI Listing Support (category left to the seller
  after an accuracy experiment; wrong-brand guard), Depop, Poshmark Smart List
  (https://www.retaildive.com/news/poshmark-generative-ai-smart-list-tool/739025), OLX Group
  (https://www.prnewswire.com/pt/comunicados-de-imprensa/olx-group-launches-agentic-selling-and-dealfinder-as-research-shows-customers-want-ai-they-can-trust-302921353.html),
  Mercari (https://careers.mercari.com/en/mercan/articles/50426).
