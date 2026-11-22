# Research profile answers

Canned answers of the Hermes research profile, served by the MockServer of the API test stack
(`docker/mock-server`) to `POST /p/marketdesk-research/v1/chat/completions`. `HermesMockSteps` registers them per
product name and graph node. Each file is the whole chat-completions body; the app reads only
`choices[0].message.content` and `usage`.

The answers are synthetic. They are derived from a real research run of 2026-11-22 for "AOPEN QH11 projektor"
(condition good, category projectors, PLN), with every third-party detail replaced: advert ids and slugs, shop
product ids, offer titles, the other models of the same class and their pages are invented, and the prices are
moved but kept plausible.

Kept from the recording on purpose, because the app's parsers and filters must cope with them:

- the hosts and URL shapes: an OLX advert on `olx.pl` without `www` and with the `?search_reason=search%7Corganic`
  tail, Ceneo and shop product pages, shop category paths for the models of the same class;
- `1280×720` next to `1280 x 720` for the same resolution, `unit: "pixels"`, and `ANSI lumens` next to `ANSI lum.`;
- the attribute names, the `equal`/`ratio` matches and the token counts in `usage`.

| File | Node | What it answers |
| --- | --- | --- |
| `identify.json` | identify | The model, its class attributes, one successor and three models of the same class |
| `identify-prose.json` | identify | Prose without JSON, which the graph cannot use and retries once (invented) |
| `same-model-used.json` | sameModelUsed | One used advert of the same model |
| `last-new-price.json` | lastNewPrice | Two last new prices, one of them archived |
| `substitutes-new.json` | substitutesNew | Two new items of the same class |
| `substitutes-used.json` | substitutesUsed | One used item of the same class (invented: the recorded answer was empty) |
| `substitutes-used-empty.json` | substitutesUsed | `{"anchors":[]}`, as recorded |

The new substitutes are priced so that both last new prices stay under the price sanity ceiling (three times the
median new substitute price). In the recorded run the new substitutes tier had failed, so the ceiling did not
apply there.
