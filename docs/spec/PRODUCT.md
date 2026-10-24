# Product contract

## Purpose

MarketDesk is a workspace-scoped operating system for managing products, marketplace listings, pricing, marketplace health, analytics, and Hermes-assisted decisions from one interface.

## Source-of-truth hierarchy

Use these artifacts in this order. A lower item may clarify a higher item, but must not silently erase or contradict it.

1. **Product behavior and acceptance:** [`../design/MarketDesk PRD.dc.html`](../design/MarketDesk%20PRD.dc.html). This original 18-section PRD is the canonical product contract.
2. **Visual composition and interaction usage:** [`../design/MarketDesk.dc.html`](../design/MarketDesk.dc.html) and curated [`../design/screenshots/`](../design/screenshots/). The companion is an implementation reference, not a separate product scope.
3. **Architecture:** [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) is canonical. [`../../ARCHITECTURE_AMENDMENTS.md`](../../ARCHITECTURE_AMENDMENTS.md) preserves historical review decisions and never overrides current code or the canonical architecture.
4. **Current maturity and approved deviations:** this file. Maturity limits must be represented honestly in the UI; they do not remove the PRD capability or roadmap surface.
5. **Delivery state:** [`TRACEABILITY.md`](TRACEABILITY.md), GitHub issues and merged PR evidence.

When sources conflict, do not guess. Open or update an issue, record the approved decision under **Approved deviations**, then update traceability and tests in the same delivery cycle.

## Current maturity

- OLX is the only validated real marketplace integration.
- Other PRD marketplaces are roadmap/unavailable surfaces. They must never appear connected or initiate a fake integration flow.
- By default OLX runs as a labelled sandbox that never contacts OLX, and AI assistance falls back to labelled offline heuristics when Hermes is unreachable; see **Approved deviations**, Sandbox mode.
- Product creation, Hermes activity, dashboard, product details, settings, analytics and the common shell are partially implemented; their open acceptance gaps are tracked in [`TRACEABILITY.md`](TRACEABILITY.md).
- Remote marketplace truth remains separate from local state. Normalized states include pending moderation, active, unavailable and unknown; raw provider state remains inspectable where available.
- Hermes recommendations are reviewable proposals. Approval applies product changes and queues supported live-listing updates; it must not silently claim unsupported automation.

## Approved deviations from the original PRD

| Area | Decision | Product consequence | Evidence |
| --- | --- | --- | --- |
| Marketplace availability | OLX only is operational today. | Keep non-OLX channels visible only as explicit roadmap/unavailable cards; no fake connect buttons or fabricated metrics. | PRD §12 · `TRACEABILITY.md` §12 · [#174](https://github.com/ylazakovich/hermes-marketdesk/issues/174) |
| Sandbox mode | OLX sandbox: while `OLX_ADAPTER_MODE` is not `real` (default `stub`), OLX is a labelled sandbox. A stand-in account connects without OLX credentials, category lookup and publication quota use built-in stand-ins, publishing never contacts olx.pl, live adverts carry placeholder `olx.pl/d/oferta/sandbox-…` links, and remote import is refused. AI fallback: while no Hermes Agent API server is configured and reachable (`HERMES_PROVIDER_MODE=auto`), AI assistance uses built-in offline heuristics. | Every OLX surface shows a `Sandbox` label while the sandbox is active, and sandbox results are never presented as marketplace truth or as real analytics. A stored sandbox connection is refused in real mode and must be reconnected. Offline suggestions say that Hermes was not consulted, and the title, price and description changes they propose always wait for human review. | PRD §10 · §12 · `TRACEABILITY.md` §10/§12 · [#139](https://github.com/quokkify/marketdesk/issues/139) · [#174](https://github.com/quokkify/marketdesk/issues/174) · `docs/superpowers/plans/2026-10-24-mvp-reanimation.md` |
| Provider lifecycle | Marketplace state is provider truth, separate from local draft/live state. | Unknown or moderation states must not be shown as active. | PRD §12 · `TRACEABILITY.md` §12 · `ARCHITECTURE_AMENDMENTS.md` · [PR #162](https://github.com/ylazakovich/hermes-marketdesk/pull/162) |
| Dangerous automation | Publication, relist, category changes and quota overrides remain guarded. | Full-auto mode cannot bypass marketplace quota/category safety. | PRD §10/§13 · `TRACEABILITY.md` §10/§13 · [#164](https://github.com/ylazakovich/hermes-marketdesk/issues/164) · [#169](https://github.com/ylazakovich/hermes-marketdesk/issues/169) |
| Draft and below-cost pricing | Zero is valid for incomplete draft pricing. Equal-to-cost is valid. Below-cost create/edit is an intentional exception and requires the explicit `allowBelowCost: true` confirmation; negative prices remain invalid. Approved Hermes recommendations count as explicit human confirmation. Remote imports fail closed if they would newly violate a known local cost. Future bulk pricing must use the same confirmation contract. | Sellers can preserve incomplete drafts without inventing prices, while loss-making decisions are warned, confirmed and recorded in product domain-event audit evidence. This explicitly supersedes the strict `price > 0` / `selling ≥ cost` create-edit wording in PRD §7–§8 while retaining its safety intent. | PRD §7–§8 · `ARCHITECTURE.md` §3 · `TRACEABILITY.md` pricing decision · [#177](https://github.com/ylazakovich/hermes-marketdesk/issues/177) |
| Settings: Security, API keys, Telegram, notification delivery | Password change, two-factor authentication, session management, API-key management and the Telegram connection have no backend contract in this release, so they are not available. Notification preferences are stored; no channel delivers in this release (Telegram connection unavailable). | Security, API Keys and Telegram are explicit roadmap panels: Security shows its three rows with disabled actions labelled `Not available in this release`; API Keys and Telegram show a roadmap marker and one explanatory line. The Notifications matrix says preferences are saved now and delivery is not active, keeps email and in-app switches editable as stored preferences, and disables the Telegram column with `Not available in this release`. No fabricated sessions, keys, bot handles or connection state, and the settings contract reports `api_keys` and `telegram` as unavailable. | PRD §13.3 · §13.5 · §13.7 · §13.8 · `TRACEABILITY.md` §13 · [#143](https://github.com/quokkify/marketdesk/issues/143) · [#145](https://github.com/quokkify/marketdesk/issues/145) · [#147](https://github.com/quokkify/marketdesk/issues/147) · [#148](https://github.com/quokkify/marketdesk/issues/148) |

Add future deviations only after an explicit product decision. Include the issue/ADR and the affected PRD section.

## Definition of done

A product/UI issue is complete only when all applicable evidence exists:

- every original acceptance criterion is checked against the implementation;
- placeholders and disabled controls are explicitly out of scope in an approved deviation, not counted as implementation;
- behavior tests cover success, empty, loading, error and guarded/destructive states as applicable;
- visual evidence compares the deployed route with the companion at desktop light/dark and a narrow viewport;
- keyboard/focus and accessible names are verified for changed controls;
- the deployed flow is exercised without mutating real marketplace data unless separately authorized;
- `TRACEABILITY.md` is updated with code, tests, issue and PR evidence;
- review findings and CI are resolved for the current head.

A component rendering, route existing, placeholder copy, mocked metric or green build alone is not completion.
