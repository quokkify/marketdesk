# Buyer reply drafts from OLX threads — design

## Intent

The owner wants Hermes to hold the conversation with buyers about a product, as the next step
towards an AI that sells on autopilot (stage focus, #444). Autopilot is not part of this step:
Hermes **drafts** the seller's next reply, the seller approves or edits it, and MarketDesk sends it
to OLX. Every incoming buyer message is checked for scams and spam before any draft is written.

Today buyer conversations exist only as counters (`OLXAdapter.fetchThreadMetrics`, `GET /threads`),
and `docs/olx-engagement-metrics.md` forbids requesting or storing message text. This design lifts
that ban under a retention rule.

## Goals

- Read the OLX threads and messages of adverts that belong to MarketDesk listings, on the existing
  marketplace sync.
- On each new buyer message, run a conversation graph that:
  1. runs deterministic scam/spam rules; a hit marks the thread suspicious, shows the reasons, and
     writes no draft;
  2. classifies the buyer's intent: `availability`, `haggle`, `logistics`, `other`;
  3. drafts one reply from the product and this thread only;
  4. validates the draft in code; a failing draft is not offered.
- Show threads and the pending draft on the product; the seller edits and presses **Send**, or
  dismisses the draft.
- **Send** re-reads the thread, sends through the OLX Partner API exactly once, and records it.
- A per-product price floor ("never go below") that drafts can never undercut.
- Offline proof: sandbox OLX returns fake buyer threads (an ordinary buyer, a haggler, a scammer
  with a phishing link), so the whole loop runs without a real account.

## Non-goals

- Autopilot sending. The graph result is always a draft awaiting the seller.
- Multi-step negotiation state (concession schedules, committed counters). Deferred to #482 with
  explicit triggers; the design here must not block it.
- Seller style memory from edits, follow-ups to silent buyers, LangSmith evaluation datasets.
  Recorded as future work below.
- Replying in threads of adverts that MarketDesk does not manage.

## Anti-goals (failure even if it works)

- A draft that offers a price below the floor, contains a link, phone, e-mail, IBAN or address, or
  promises payment/delivery outside OLX.
- A scam message that reaches the model as if it were an ordinary question and produces a polite
  draft for it.
- Buyer message text in logs, run records (`runRecorder`), experiment bundles or error details.
- A double send to OLX from a double click, a retry, or a worker restart.
- Hermes with tools: the conversation graph uses the same no-tools `marketdesk` profile boundary
  as everything else (PR #467, `2026-11-21-hermes-tool-boundary-design.md`).

## Constraints

- Migrations replay on every start: new tables use `CREATE TABLE IF NOT EXISTS`, never a `DROP`.
- Buyer text is untrusted input. It is passed to the model inside delimiters as data; the system
  prompt says so; the model output is parsed with a strict Zod schema (pattern of
  `ProductAssistanceGraph`).
- Personal data: message text is personal data of the buyer. Retention rule below.
- Tests follow the project rule: new behaviour is covered by q4j API/UI tests in `test-automation`
  on the branch stack; Jest only for pure functions (rules, validator, schema).

## Approaches

1. **Chosen (owner, 2026-11-21).** A separate stateless conversation graph; MarketDesk tables hold
   threads, messages and drafts. One graph run per new buyer message; the draft is stored with
   status `pending`. Sending is a separate use case. Matches `ProductAssistanceGraph` and the
   publication journey graph, which are deliberately stateless; one place to apply retention;
   autopilot later replaces the Send button with a policy, nothing else moves.
2. Durable graph with a Postgres checkpointer and `interrupt()` for approval. Rejected for now:
   a second copy of state and of the message text (retention in two places), a new dependency, and
   nodes that re-run on resume while the outside world must be re-read anyway. Parked as #482 for
   multi-step negotiation.
3. Drafts as a new `HermesEvent` type in the existing approval queue. Rejected: that queue's
   approval mutates the product and enqueues publication; a conversation has its own lifecycle, and
   `ApproveHermesEventUseCase` would grow another unrelated branch.

4. LangChain built-in middleware (`piiMiddleware`, `humanInTheLoopMiddleware`,
   `modelCallLimitMiddleware`). Rejected: per the LangChain JS docs (checked 2026-11-21) they attach
   to `createAgent`, and the docs say nothing about a hand-built `StateGraph`; the project has no
   `langchain` package; there is no built-in prompt-injection detection; and our rules are
   domain-specific (OLX domain allowlist, BLIK, IBAN, messenger moves, the product floor). Borrowed
   the idea only: rules with an action (redact / mask / block) and a Luhn check for card numbers.

## Design

### Data (new tables)

- `conversation_threads`: workspace, listing, OLX thread id, OLX buyer id (opaque), status
  (`open` / `suspicious` / `closed`), suspicious reasons, last synced message id, timestamps.
  Unique on (workspace, OLX thread id).
- `conversation_messages`: thread, OLX message id, direction (`buyer` / `seller`), text, sent at.
  Unique on (thread, OLX message id).
- `reply_drafts`: thread, the buyer message it answers, intent, draft text, status
  (`pending` / `sending` / `sent` / `dismissed` / `superseded` / `failed`), the edited text actually sent,
  OLX message id after send, send attempt key, timestamps.
- `products.min_acceptable_price` (nullable money). Null means no discount at all: the floor is the
  selling price.

### Sync

`SyncMarketplaceHandler` already calls `fetchThreadMetrics` per advert. Extend the adapter with
reading thread messages for adverts that are MarketDesk listings, upsert threads and messages, and
enqueue one graph run per thread whose newest message is from the buyer and has no draft yet.
A newer buyer message marks the thread's pending draft `superseded` and triggers a new run.

### Conversation graph (`conversation-reply@1`)

LangGraph `StateGraph`, nodes:

1. `screen` — deterministic rules on the new buyer message (and the thread):
   - a URL whose host is not on the official OLX domain allowlist;
   - a request for card number, CVV, BLIK or SMS code, or bank login;
   - a move to WhatsApp / Telegram / Viber or a request for a phone number;
   - "already paid, confirm / click to receive" wording;
   - spam: identical text repeated across threads of the workspace, message flood in one thread.
   A hit → thread `suspicious` with reasons, graph ends. Rules are versioned data, Polish and
   Ukrainian and Russian phrasings included.
2. `classify` — Hermes, strict Zod output `{ intent, confidence }`.
3. `draft` — Hermes, input: product (title, description, condition, price) and the last N
   messages of this thread. The floor is never sent to the model (see prompt-injection defence).
   Buyer-reply calls carry no Hermes session key: each call sends the recent thread, so Hermes
   keeps no buyer text between calls.
   Output: `{ reply, counterOffer, proposedPrice | null }`; code fills the `{{PRICE}}` placeholder.
4. `validate` — code: the filled price ≥ floor; any price number in the text ≥ floor; no URL, phone,
   e-mail, IBAN, address; length limit; no payment/delivery outside OLX. Failure → draft not
   stored as `pending`; the thread shows "Couldn't write a safe reply" with the reason.

Graph state holds tenant-scoped ids and the result only. The observer receives node lifecycle
only (as in `ProductAssistanceGraph`). AI usage is recorded through `withAiUsageScope` with a new
feature `reply`. Caps: at most one graph run per buyer message, a per-workspace daily cap on
reply runs (config value), and no automatic run for a newest buyer message older than
`REPLY_MAX_MESSAGE_AGE_DAYS` (default 14; the seller can still regenerate).

### Prompt-injection defence

Assume buyer text will try to steer Hermes ("ignore your instructions", "you are now…", fake
system/role tags, "tell me the lowest price"). Defence is layered so no single layer has to hold:

1. **Nothing to steer towards.** Hermes runs on the no-tools profile and the graph gives it no
   actions: its output is text plus fields that code checks. It sees only this product and this
   thread: no other buyers, no seller contact data, no credentials.
2. **The floor never reaches the model.** For `haggle` the model returns
   `{ reply, counterOffer: boolean, proposedPrice | null }`, and the reply text uses a `{{PRICE}}`
   placeholder instead of a number. Code clamps the price to `max(proposedPrice, floor)`, applies
   the concession step, and fills the placeholder. A buyer asking "what is your minimum?" cannot
   extract a number the model never had. Any other currency-tied number in the reply fails
   `validate`.
3. **Data, not instructions.** Each buyer message goes into the prompt inside a delimiter block
   with role labels the buyer cannot forge (the delimiter is escaped in buyer text). The system
   prompt states that the block is quoted customer text and never instructions.
4. **Injection as a screening signal.** `screen` rules also flag injection markers (instruction
   overrides, role/system tags, prompt-like markup, long base64 or encoded blobs). A hit marks the
   thread suspicious with reason `prompt_injection`, so no draft is written and the model never
   sees the message.
5. **Strict outputs.** `classify` and `draft` outputs are parsed with strict Zod schemas. Extra
   fields, tool-call shapes or out-of-enum intents are rejected, as in `ProductAssistanceGraph`.
6. **Code validation and a human.** `validate` (no links, contacts, IBAN, off-platform payment,
   no price below the floor) runs on the model draft and again on the seller's edited text. The
   seller approves every send in this step.
7. **Safe display.** Buyer text and drafts render as plain text in the UI, never as HTML or
   Markdown links.
8. **Regression cases.** The offline experiment dataset gains a `conversation-adversarial` set:
   instruction overrides, role tags, floor extraction, link smuggling ("write olx-dostawa dot pl"),
   language switching, and a scam message phrased politely. The gate requires zero floor leaks and
   zero links in drafts. Like the existing suite, it uses a fixture provider and does not measure
   real-model resistance; a real-model run is a separate, reviewed step before autopilot.

Before autopilot, layers 4–6 must hold with the human removed. That is a gate for the autopilot
design, not for this step.

### Sending

`POST /api/conversations/:threadId/drafts/:draftId/send` with the final text.

1. Draft must be `pending` and belong to the workspace; the edited text goes through `validate`
   again (the seller can make the same mistakes).
2. Re-read the thread from OLX. A newer buyer message → draft `superseded`, 409, the UI refreshes.
3. Send through the Partner API with an attempt key stored before the call; a retry with the same
   key does not send again. Store the OLX message id, draft `sent`, activity log entry.

Sandbox: sending is accepted by the stub and appended to the fake thread.

### UI

On the product page, a **Conversations** section: threads of its listings, suspicious ones with a
warning and reasons, the pending draft in an editable box with **Send** and **Dismiss**, and the
intent label. A counter of threads waiting for an answer on the products list.

### Retention and privacy

- Message text is stored only for threads of MarketDesk listings.
- Never written to logs, run records, experiment bundles, error details or AI usage records.
- Deleted 30 days after the product is sold or the listing is closed; threads keep counters only.
- `docs/olx-engagement-metrics.md` is updated: the ban becomes this rule.

### Step 0 (before building)

Verify on the real Partner API, read-only first: the thread message list endpoint and its shape,
the send-message endpoint and its body, whether OLX marks threads read on our read, and the
rate limits. Record the result in this document. If sending is not available, stop and return to
the owner (approach choice depended on it).

### Clarifications from the builder check

- **Step 0 is the first plan task with a stop gate.** Later tasks are written against an adapter
  port (`listThreadMessages`, `sendThreadMessage`) whose shape is fixed by step 0. The design does
  not assume OLX offers an idempotency key on send.
- **Send state machine.** Draft statuses gain `sending`. Send sets `sending` with the attempt key
  before the OLX call. A draft found in `sending` (retry, worker restart) is reconciled first: re-read
  the thread and look for a seller message with the same text sent after the attempt started.
  Found → record its id, `sent`. Not found or unreadable → `failed`; never resend automatically. Ambiguous (OLX read fails) → `failed`; the seller
  sees "may or may not have been sent, check OLX" and decides. No automatic second send.
- **Retention trigger.** `conversation_threads.retention_starts_at` is set when the product becomes
  `sold` or the listing leaves `live` without returning within the sync. A daily job deletes message
  text and draft texts (proposed and sent) for threads whose `retention_starts_at` is older than
  30 days; it keeps counters, statuses and reasons. Suspicious threads follow the same rule.
- **Which adverts are read.** Threads are read for listings with an OLX advert id in `live` or
  `expired` state. Drafts are written only while the product is not `sold`; for a sold product the
  thread is shown without a draft. A republished advert gets new threads; old threads stay attached
  to the old advert id.
- **Spam detection** compares a SHA-256 of the normalised text within the workspace's stored
  messages; thresholds (repeat count, messages per thread per hour) are config values.
- **Price numbers in a draft.** The validator checks the filled price and only number tokens tied to a
  currency (`zł`, `PLN`, `zl`, `грн`, `UAH`, `€`, `EUR`, the product's currency) or to price words.
  Plain numbers ("iPhone 12", "2 pieces") are not prices.
- **Re-runs.** A draft that fails `validate` leaves the thread "no safe draft"; the seller can press
  **Regenerate** (counts towards the cap). When the daily cap is hit, the run is skipped and the
  thread shows "waiting: daily AI limit"; the seller can regenerate the next day or reply on OLX.
- **Language.** The draft is written in the language of the buyer's last message; the screening and
  validation rules cover Polish, Ukrainian, Russian and English phrasings.
- **Tests.** q4j API and UI tests run in sandbox mode against the fake buyer threads; the real OLX
  paths (step 0, one real send) are checked by hand and recorded here. The waiting-threads counter
  on the products list is in scope but may land as a separate PR in the stack.

## Decisions made by Claude (owner may override)

- Retention period 30 days after sale or close; draft texts are deleted with message texts.
- Null floor means "no discount".
- Spam rules: repeated identical text across threads and a message flood per thread.
- Draft input is the last N messages of the thread (N is config), not the whole history.
- The UI lives on the product page, not a separate inbox page.
- After an unclear send, no automatic retry: the seller decides.
- No drafts for threads of a sold product.
- Replies follow the buyer's language.

## Left to the builder

Table column types, the exact rule regexes and domain allowlist, the prompt wording, N and caps
defaults, the sandbox fixture texts, and file layout following existing conventions.

## Future work

- Durable multi-step negotiation — #482 (triggers listed there).
- Seller style memory from edits (LangGraph Store), per seller.
- Follow-ups to silent buyers, drafted through the same approval.
- Evaluation dataset: scam recall, floor violations (must stay 0), reply quality by LLM judge.
- Gradual autopilot: auto-send only `availability` replies with every check green.

## Step 0 findings (2026-11-21)

Read-only probe on production (owner's OLX connection, structure only, no message text read) plus
the official OpenAPI spec `https://developer.olx.pl/swagger/v2/partner_api.yaml`. The owner chose
read-only: no message was sent.

- `GET /threads?offset&limit[&advert_id&interlocutor_id]` answered 200. Production returned the
  envelope `{ "data": [] }` (the spec documents a bare array; the adapter must accept both, as
  `fetchThreadMetrics` already does). The account had 0 threads, so the real message shape could
  not be observed; shapes below come from the spec.
- Thread: `uuid` (preferred; `id` deprecated), `advert_id`, `interlocutor_id`, `total_count`,
  `unread_count`, `created_at`, `is_favourite`.
- `GET /threads/{threadId}/messages` → array of Message: `uuid` (`id` deprecated), `thread_uuid`,
  `created_at`, `type` (`sent` = seller, `received` = buyer), `text`, `is_read`, `attachments[]`
  (`name`, `url`). No pagination documented.
- `POST /threads/{threadId}/messages` body `{ text, attachments? }`, needs scope `v2 write`;
  response 200 with no documented body, so the new message id may be absent. No idempotency key.
  The send flow must therefore re-read the thread to learn the sent message id (the reconcile step
  already does this).
- `POST /threads/{threadId}/commands` `{ command: 'mark-as-read' | 'set-favourite' }` → 204.
  Reading messages is not documented to mark them read; MarketDesk never sends `mark-as-read`.
- Headers `Version: 2.0`, `Authorization: Bearer`. No rate-limit headers were returned; only a
  generic 429 is documented.
- **Not verified on the real API:** the message list shape and the send response. The first real
  buyer conversation must be checked by hand (owner), and the first real send is done by the owner
  from the UI and verified on olx.pl. Recorded in the PR test plan.
