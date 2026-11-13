# MarketDesk core flow: publish a product to OLX (sandbox) and open its product card

Video: https://github.com/quokkify/marketdesk/raw/demos/demos/448/6b5389f759d9/demo.mp4
Commit: `6b5389f759d9`
Duration: 1:24

### Shown
- CUT-1 (four destinations; Products is the landing page): chapter 1: the menu and the empty catalogue
- CORE-1 (a product is created in the six-step wizard, with photos, and OLX is the only marketplace offered): chapter 2: the wizard from Photos to Review
- CORE-2 (publication needs an explicit confirmation with an exact OLX category): chapter 3: the publication review
- CORE-3 (the listing goes Live and is labelled Sandbox): chapter 4: the product card after publishing
- CORE-4 (the product card shows the gallery, price and margin, the OLX listing and the timeline): chapter 4: the product card, top to bottom
- CORE-5 (the published product is Active in the catalogue): chapter 5: the catalogue

### Open questions
- The publication review opens by itself right after a product is created. Is that the wanted first step toward autopilot, or should creation end on the product card?
- Views, watchers and messages read "Unknown" on a fresh listing until the first sync. Should the product card hide them until there is data?
- The listing SEO agent has no settings screen any more (it can be switched only through the API). Is that acceptable until the autopilot loop is built?

### Not shown
- Connecting the OLX sandbox account: done once before the recording (one button on the Marketplaces page)
- A real OLX advert: the stand runs the OLX sandbox, which makes no call to OLX
- Hermes suggestions and their approval: outside this demo; without a Hermes server they come from offline heuristics and wait for review
- The removed screens and endpoints (Dashboard, Analytics, Listings, notification settings, import): gone from the interface, so there is nothing to film
- Sales and buyer messages: the sandbox has none
