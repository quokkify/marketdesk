# Changelog

## [0.21.0](https://github.com/quokkify/marketdesk/compare/marketdesk-v0.20.0...backend-v0.21.0) (2026-10-03)


### ✨ Features

* **release:** split releases by component ([#339](https://github.com/quokkify/marketdesk/issues/339)) ([536913b](https://github.com/quokkify/marketdesk/commit/536913b9ac911d92430629c79fdc3123a2690585))

## Inherited legacy history

These are combined MarketDesk releases, not independently published backend versions. Original dates, compare links, commit and PR links remain authoritative. The 1.0.0 bootstrap snapshot repeats earlier work; it is not a component version bump.

Shared-only tooling, documentation, build and lockfile entries are archived once here with explicit labels; they are not backend-specific changes. Runtime dependency entries also follow their source importers.

See the [migration audit](../../docs/deployment/changelog-history-migration.md) for path evidence, overlap accounting and release-order limitations.

## Legacy [0.20.0](https://github.com/quokkify/marketdesk/compare/marketdesk-v0.19.2...marketdesk-v0.20.0) (2026-10-03)

<!-- project-toolkit:rich-block:start -->
<!-- project-toolkit:rich-release-notes pr=311 -->
### ✨ Highlights
**Create product → Prepare listing → Check readiness → Review → Publish**

**1. Review the product**

![Product creation review screen](https://raw.githubusercontent.com/quokkify/marketdesk/c0fbd206ee1848c5882202c0046cf6ff21c2a44e/docs/screenshots/issue-290/01-create-product.png)

**2. See optional wording and price suggestions**

![Product assistant suggestions](https://raw.githubusercontent.com/quokkify/marketdesk/c0fbd206ee1848c5882202c0046cf6ff21c2a44e/docs/screenshots/issue-290/02-review-suggestions.png)

**3. Confirm publication**

![Publication confirmation screen](https://raw.githubusercontent.com/quokkify/marketdesk/c0fbd206ee1848c5882202c0046cf6ff21c2a44e/docs/screenshots/issue-290/03-confirm-publication.png)

*Screenshots use mocked demo data. Suggestions are optional, and publication remains your decision.*
<!-- project-toolkit:rich-block:end -->

### ✨ Features

<!-- legacy-entry:0 -->
* add reproducible sales agent experiment bundles ([#315](https://github.com/quokkify/marketdesk/issues/315)) ([79f2673](https://github.com/quokkify/marketdesk/commit/79f26736ab416fc9ffec133b5bf470f9b4ed4ccf))

<!-- legacy-entry:1 -->
* graph-backed product publication journey via LangGraph ([#311](https://github.com/quokkify/marketdesk/issues/311)) ([04bdd47](https://github.com/quokkify/marketdesk/commit/04bdd47fd2def495999401e9a1e8e9c8070488cd))

### 🐛 Bug Fixes

<!-- legacy-entry:2 -->
* rate limit upload test app ([#329](https://github.com/quokkify/marketdesk/issues/329)) ([f0f020e](https://github.com/quokkify/marketdesk/commit/f0f020e6888ac5b0d56b11283059fa077305f90b))

<!-- legacy-entry:3 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **release:** use unprefixed release tags ([#291](https://github.com/quokkify/marketdesk/issues/291)) ([823a20b](https://github.com/quokkify/marketdesk/commit/823a20bde61e22309404d443faaa2851ee68b8b1))

<!-- legacy-entry:4 -->
* **security:** address CodeQL findings ([#320](https://github.com/quokkify/marketdesk/issues/320)) ([8f76a0d](https://github.com/quokkify/marketdesk/commit/8f76a0d953a7c6a702f9290630ddddbb3fbae7bd))


## Legacy 1.0.0 (2026-09-25)

Inherited bootstrap snapshot: overlaps prior combined releases; repeated entries below are retained as originally recorded, not new releases.

### Features

<!-- legacy-entry:5 -->
* **analytics:** restore historical reporting ([#247](https://github.com/quokkify/marketdesk/issues/247)) ([36915a5](https://github.com/quokkify/marketdesk/commit/36915a5e4a4a15098052f0786d6af8caa339de28))

<!-- legacy-entry:6 -->
* **auth:** provision OLX marketplace for new workspaces ([#75](https://github.com/quokkify/marketdesk/issues/75)) ([8449d75](https://github.com/quokkify/marketdesk/commit/8449d7597bc3e091092f584cbaedfa7da6a89c81))

<!-- legacy-entry:8 -->
* close MarketDesk product and AI tasks ([#162](https://github.com/quokkify/marketdesk/issues/162)) ([125081b](https://github.com/quokkify/marketdesk/commit/125081b9eb74fe03fb2a0fcaa66634808d1ee0f6))

<!-- legacy-entry:9 -->
* **hermes:** add product-scoped listing SEO analysis ([#263](https://github.com/quokkify/marketdesk/issues/263)) ([846beb3](https://github.com/quokkify/marketdesk/commit/846beb3eff7a0b27e05e9307dd72ce8fe4c9e05a))

<!-- legacy-entry:11 -->
* **hermes:** define canonical event lifecycle ([#186](https://github.com/quokkify/marketdesk/issues/186)) ([64d1a64](https://github.com/quokkify/marketdesk/commit/64d1a64e9b27f551222ab8adcff2d1832f1f3f83))

<!-- legacy-entry:13 -->
* **hermes:** use native agent API for AI suggestions ([#8](https://github.com/quokkify/marketdesk/issues/8)) ([b34b724](https://github.com/quokkify/marketdesk/commit/b34b724dae735644f691933743dd701c24401225))

<!-- legacy-entry:14 -->
* implement MarketDesk multi-marketplace SaaS platform ([#1](https://github.com/quokkify/marketdesk/issues/1)) ([2259d71](https://github.com/quokkify/marketdesk/commit/2259d71d96ac742ad5eb07a5b97bada6915de88b))

<!-- legacy-entry:15 -->
* **listings:** add publish preview dry run ([#77](https://github.com/quokkify/marketdesk/issues/77)) ([d096106](https://github.com/quokkify/marketdesk/commit/d0961064639e5667322144a124878e6db00b5e91))

<!-- legacy-entry:16 -->
* **listings:** add safe delist-to-draft workflow ([#238](https://github.com/quokkify/marketdesk/issues/238)) ([57569be](https://github.com/quokkify/marketdesk/commit/57569beb72ee33178a592d3c68d1082f1dc7356d))

<!-- legacy-entry:17 -->
* **listings:** confirm OLX quota override in publish review ([#202](https://github.com/quokkify/marketdesk/issues/202)) ([4627ed8](https://github.com/quokkify/marketdesk/commit/4627ed89a9b28f0f328e933dfac58cb3197c13b4))

<!-- legacy-entry:18 -->
* **listings:** create draft listings from products ([#76](https://github.com/quokkify/marketdesk/issues/76)) ([22cbcd6](https://github.com/quokkify/marketdesk/commit/22cbcd6378ce520116f5a3941ad187f3c9ba976e))

<!-- legacy-entry:19 -->
* **listings:** expose canonical marketplace links ([#111](https://github.com/quokkify/marketdesk/issues/111)) ([e7d086d](https://github.com/quokkify/marketdesk/commit/e7d086da187f9852e9294e17616c9769fe64533a))

<!-- legacy-entry:20 -->
* **olx:** add conversations metric ([#262](https://github.com/quokkify/marketdesk/issues/262)) ([d812b6d](https://github.com/quokkify/marketdesk/commit/d812b6de385f964fd178085e17708159b8bfdc0a))

<!-- legacy-entry:21 -->
* **olx:** add import preview foundation ([#112](https://github.com/quokkify/marketdesk/issues/112)) ([83a1006](https://github.com/quokkify/marketdesk/commit/83a1006fa8ac91fbdf5aaaa7de78926f29b2978a))

<!-- legacy-entry:22 -->
* **olx:** add OAuth and guarded real publishing ([#93](https://github.com/quokkify/marketdesk/issues/93)) ([a13125f](https://github.com/quokkify/marketdesk/commit/a13125fc2ce00fdb93501d9d4bcb434629ce465e))

<!-- legacy-entry:23 -->
* **olx:** add quota-aware zero-spend publish guard ([#167](https://github.com/quokkify/marketdesk/issues/167)) ([14f6633](https://github.com/quokkify/marketdesk/commit/14f66334a4a2bf29f8a2e871ffae05cc6796cd48))

<!-- legacy-entry:24 -->
* **olx:** import existing adverts ([#133](https://github.com/quokkify/marketdesk/issues/133)) ([7403716](https://github.com/quokkify/marketdesk/commit/74037161f96b53d83b16e84830b04d61d5d4d37b))

<!-- legacy-entry:25 -->
* **olx:** prepare real API transport ([#79](https://github.com/quokkify/marketdesk/issues/79)) ([ee64067](https://github.com/quokkify/marketdesk/commit/ee640670bdb93bba434740fc34cd44eb37946133))

<!-- legacy-entry:26 -->
* **olx:** preserve unavailable engagement metrics ([#110](https://github.com/quokkify/marketdesk/issues/110)) ([d73402d](https://github.com/quokkify/marketdesk/commit/d73402de67f88a06cd2a71576802f391bdc0b4bc))

<!-- legacy-entry:27 -->
* **olx:** preview owned advert imports ([#119](https://github.com/quokkify/marketdesk/issues/119)) ([6b4ac91](https://github.com/quokkify/marketdesk/commit/6b4ac91494610c46c171f75df72e1da0eb3327e8))

<!-- legacy-entry:28 -->
* **olx:** reconcile remote advert statuses ([#108](https://github.com/quokkify/marketdesk/issues/108)) ([6a55338](https://github.com/quokkify/marketdesk/commit/6a55338c927a63b27a2330cc58fcfb9d143655f7))

<!-- legacy-entry:29 -->
* **products:** add on-demand publication recheck ([#246](https://github.com/quokkify/marketdesk/issues/246)) ([446337b](https://github.com/quokkify/marketdesk/commit/446337bfb65abce9c452fe2c9834aa650937b748))

<!-- legacy-entry:31 -->
* **products:** add workspace image upload API ([#182](https://github.com/quokkify/marketdesk/issues/182)) ([be08fbe](https://github.com/quokkify/marketdesk/commit/be08fbe3764698bf71a23f3825b952e4255ee94f))

<!-- legacy-entry:32 -->
* **products:** redesign catalogue ([#223](https://github.com/quokkify/marketdesk/issues/223)) ([596102a](https://github.com/quokkify/marketdesk/commit/596102a11750e64a777911eb4d967b5a2e55d115))

<!-- legacy-entry:34 -->
* **settings:** add persistent settings contracts ([#234](https://github.com/quokkify/marketdesk/issues/234)) ([dcc7f94](https://github.com/quokkify/marketdesk/commit/dcc7f94f150bf31295ebd80158be42d76c60afd8)), closes [#149](https://github.com/quokkify/marketdesk/issues/149)

<!-- legacy-entry:35 -->
* **settings:** show installed release version ([#211](https://github.com/quokkify/marketdesk/issues/211)) ([a10524f](https://github.com/quokkify/marketdesk/commit/a10524fea85c8cb5efa333291d1fa05e99eb80f4))

<!-- legacy-entry:36 -->
* store OLX app credentials per workspace ([#129](https://github.com/quokkify/marketdesk/issues/129)) ([18d1661](https://github.com/quokkify/marketdesk/commit/18d16610abdf7b3f2ff5a1b628e56b10d5522c2e))

<!-- legacy-entry:37 -->
* **sync:** reconcile product category provenance ([#214](https://github.com/quokkify/marketdesk/issues/214)) ([8de95e0](https://github.com/quokkify/marketdesk/commit/8de95e0c54634f7f717a03b51bfe46020a60831a))

<!-- legacy-entry:38 -->
* **sync:** schedule marketplace sync modes safely ([#109](https://github.com/quokkify/marketdesk/issues/109)) ([6f06a5f](https://github.com/quokkify/marketdesk/commit/6f06a5f8e551778b5f1261979e453578e0598b3d))

### Bug Fixes

<!-- legacy-entry:41 -->
* **analytics:** reconcile signed view baseline ([#253](https://github.com/quokkify/marketdesk/issues/253)) ([a2fc008](https://github.com/quokkify/marketdesk/commit/a2fc00885ab796950866e91d472c5799dc48f8a3))

<!-- legacy-entry:42 -->
* **analytics:** restore legacy view baseline ([#249](https://github.com/quokkify/marketdesk/issues/249)) ([e552a8d](https://github.com/quokkify/marketdesk/commit/e552a8d2bc39ff172442bec76aa0ee5280d6cfc9))

<!-- legacy-entry:44 -->
* **analytics:** show readable listing identity ([#105](https://github.com/quokkify/marketdesk/issues/105)) ([c93ad34](https://github.com/quokkify/marketdesk/commit/c93ad34afbbee2fda7a94ed05a5cb4b989687356))

<!-- legacy-entry:47 -->
* **deploy:** initialize writable upload storage ([#206](https://github.com/quokkify/marketdesk/issues/206)) ([936cee1](https://github.com/quokkify/marketdesk/commit/936cee1397d77c18c0a5e1fbfc5926d74a350935))

<!-- legacy-entry:48 -->
* **deploy:** make database TLS mode explicit ([#205](https://github.com/quokkify/marketdesk/issues/205)) ([6169286](https://github.com/quokkify/marketdesk/commit/61692867515d2270d8db713b1c69cfebde7c1bdb))

<!-- legacy-entry:49 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** replace react-query with @tanstack/react-query ^4.0.5 ([#12](https://github.com/quokkify/marketdesk/issues/12)) ([cf28b99](https://github.com/quokkify/marketdesk/commit/cf28b993bfae86535dc799f433e11fce50bc5b74))

<!-- legacy-entry:51 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update @tanstack/react-query to v5 ([#33](https://github.com/quokkify/marketdesk/issues/33)) ([6650716](https://github.com/quokkify/marketdesk/commit/6650716eb0a0d43d2f8137f1d2da2e05b21555c6))

<!-- legacy-entry:52 -->
* **deps:** update bcryptjs to v3 ([#13](https://github.com/quokkify/marketdesk/issues/13)) ([93cf0db](https://github.com/quokkify/marketdesk/commit/93cf0db6a44b44dbfad5ceb28a4de44672a720a6))

<!-- legacy-entry:53 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update date-fns to v3 ([#22](https://github.com/quokkify/marketdesk/issues/22)) ([f78459e](https://github.com/quokkify/marketdesk/commit/f78459eb3f714258c0d16fbc45e845249399a738))

<!-- legacy-entry:54 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update date-fns to v4 ([#34](https://github.com/quokkify/marketdesk/issues/34)) ([f9140dd](https://github.com/quokkify/marketdesk/commit/f9140ddab5331d057417d9a028615453a37caff4))

<!-- legacy-entry:55 -->
* **deps:** update dotenv to v17 ([#14](https://github.com/quokkify/marketdesk/issues/14)) ([4858fbd](https://github.com/quokkify/marketdesk/commit/4858fbd52c120afc93a5a77cfe9b17ee79e241e6))

<!-- legacy-entry:56 -->
* **deps:** update express to v5 ([#41](https://github.com/quokkify/marketdesk/issues/41)) ([a56181d](https://github.com/quokkify/marketdesk/commit/a56181d0035cf2ea6faa677247d16d7f753fa235))

<!-- legacy-entry:57 -->
* **deps:** update express-rate-limit to v8 ([#15](https://github.com/quokkify/marketdesk/issues/15)) ([07d0c0b](https://github.com/quokkify/marketdesk/commit/07d0c0bcff466051dbd7e8fd33cae2a911454b2a))

<!-- legacy-entry:58 -->
* **deps:** update helmet to v8 ([#16](https://github.com/quokkify/marketdesk/issues/16)) ([bbf27aa](https://github.com/quokkify/marketdesk/commit/bbf27aa886c73855312931f02bd99cb21f5ecf3b))

<!-- legacy-entry:59 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update joi to v18 ([#35](https://github.com/quokkify/marketdesk/issues/35)) ([7641272](https://github.com/quokkify/marketdesk/commit/7641272c464a7e233be6e99f6b142901d859ce3f))

<!-- legacy-entry:62 -->
* **deps:** update pino to v10 ([#42](https://github.com/quokkify/marketdesk/issues/42)) ([351089b](https://github.com/quokkify/marketdesk/commit/351089b49cb436089bc4c2f0a99e02cd12d85376))

<!-- legacy-entry:63 -->
* **deps:** update pino to v9 ([#17](https://github.com/quokkify/marketdesk/issues/17)) ([789031e](https://github.com/quokkify/marketdesk/commit/789031e9b2365dc4fc0c56d443c6c37e0c64e0bb))

<!-- legacy-entry:64 -->
* **deps:** update pino-pretty to v11 ([#23](https://github.com/quokkify/marketdesk/issues/23)) ([fef926a](https://github.com/quokkify/marketdesk/commit/fef926ab52a6070a6590159e98a96737aebf93a9))

<!-- legacy-entry:65 -->
* **deps:** update pino-pretty to v12 ([#37](https://github.com/quokkify/marketdesk/issues/37)) ([1f85a92](https://github.com/quokkify/marketdesk/commit/1f85a92e068f859fec0f13783ea6fa6a9f268af2))

<!-- legacy-entry:66 -->
* **deps:** update pino-pretty to v13 ([#43](https://github.com/quokkify/marketdesk/issues/43)) ([bec1424](https://github.com/quokkify/marketdesk/commit/bec1424963a52326194a29d69aeb39ade4b68d8d))

<!-- legacy-entry:71 -->
* **deps:** update redis to v5 ([#30](https://github.com/quokkify/marketdesk/issues/30)) ([6e53d21](https://github.com/quokkify/marketdesk/commit/6e53d21a86952da2dd2fdbc14da76b660db39a7d))

<!-- legacy-entry:72 -->
* **deps:** update redis to v6 ([#38](https://github.com/quokkify/marketdesk/issues/38)) ([1b93815](https://github.com/quokkify/marketdesk/commit/1b938157f41c759852e0896018ee86aef545be0e))

<!-- legacy-entry:73 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update redux to v5 ([#31](https://github.com/quokkify/marketdesk/issues/31)) ([23740f3](https://github.com/quokkify/marketdesk/commit/23740f38190b93c1d3c6d3d3a8632139959b64aa))

<!-- legacy-entry:74 -->
* **deps:** update uuid to v11 [security] ([#11](https://github.com/quokkify/marketdesk/issues/11)) ([1ead758](https://github.com/quokkify/marketdesk/commit/1ead758c930589a52ef1d0f6092a4461e672392c))

<!-- legacy-entry:75 -->
* **deps:** update uuid to v12 ([#45](https://github.com/quokkify/marketdesk/issues/45)) ([0ae38f7](https://github.com/quokkify/marketdesk/commit/0ae38f70f134d17c87cbf40724d752f068832d35))

<!-- legacy-entry:76 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update uuid to v14 ([#50](https://github.com/quokkify/marketdesk/issues/50)) ([8acd36f](https://github.com/quokkify/marketdesk/commit/8acd36faa89357d49ac1e8e405fb6e12652833dc))

<!-- legacy-entry:77 -->
* **deps:** update zod to v4 ([#18](https://github.com/quokkify/marketdesk/issues/18)) ([4348867](https://github.com/quokkify/marketdesk/commit/4348867b68ce214f296b52bfc7ac1343e9f0dda5))

<!-- legacy-entry:78 -->
* **docker:** restore runtime after upgrades ([#74](https://github.com/quokkify/marketdesk/issues/74)) ([e244388](https://github.com/quokkify/marketdesk/commit/e244388bc99eaa518d61cb18939c1dcb79131c8d))

<!-- legacy-entry:81 -->
* **hermes:** allow dismiss without request body ([#116](https://github.com/quokkify/marketdesk/issues/116)) ([0317a53](https://github.com/quokkify/marketdesk/commit/0317a5340b77d39cf146be1dc8b489628d5cda45))

<!-- legacy-entry:82 -->
* **hermes:** make listing SEO Apply update product and live listing ([#272](https://github.com/quokkify/marketdesk/issues/272)) ([5bbf9bc](https://github.com/quokkify/marketdesk/commit/5bbf9bcd8c8b0e771dff0a1a9d366adfb420010e))

<!-- legacy-entry:83 -->
* **hermes:** sync approved suggestions to listings ([#131](https://github.com/quokkify/marketdesk/issues/131)) ([a487049](https://github.com/quokkify/marketdesk/commit/a48704961e4cb927d7e6fd1925a74e580c5c8d46))

<!-- legacy-entry:84 -->
* **listings:** hide draft external urls ([#113](https://github.com/quokkify/marketdesk/issues/113)) ([3874f07](https://github.com/quokkify/marketdesk/commit/3874f071747cba9ddb6e8c58f9bc7781d1d2ff54))

<!-- legacy-entry:86 -->
* **listings:** show product identity in listings ([#124](https://github.com/quokkify/marketdesk/issues/124)) ([4decc6f](https://github.com/quokkify/marketdesk/commit/4decc6fa411a3a2ad5911746d4722a3368e9deba))

<!-- legacy-entry:87 -->
* **marketplace:** fence imports to token account revision ([#243](https://github.com/quokkify/marketdesk/issues/243)) ([eb5a3b5](https://github.com/quokkify/marketdesk/commit/eb5a3b578ad9d3a3736314e78097eb07f89c989b))

<!-- legacy-entry:89 -->
* **migrations:** tolerate replayed conversations column ([#273](https://github.com/quokkify/marketdesk/issues/273)) ([7f6b7c6](https://github.com/quokkify/marketdesk/commit/7f6b7c6f870d46ec0ce2fa861bf8e2871de34637))

<!-- legacy-entry:90 -->
* **olx:** count messages from thread metadata ([#256](https://github.com/quokkify/marketdesk/issues/256)) ([29e4c68](https://github.com/quokkify/marketdesk/commit/29e4c68e01d27efc7e8547ac48dcc26a0fb90eda))

<!-- legacy-entry:91 -->
* **olx:** deliver applied Hermes changes to live adverts ([#168](https://github.com/quokkify/marketdesk/issues/168)) ([c920f12](https://github.com/quokkify/marketdesk/commit/c920f1222b017138034b1879bbaeb30227ebf80b))

<!-- legacy-entry:92 -->
* **olx:** isolate per-listing sync failures ([#271](https://github.com/quokkify/marketdesk/issues/271)) ([6b4b599](https://github.com/quokkify/marketdesk/commit/6b4b59991155f7015b11084317b84d5dfd1b7f7a))

<!-- legacy-entry:93 -->
* **olx:** map live engagement counters ([#125](https://github.com/quokkify/marketdesk/issues/125)) ([7d20372](https://github.com/quokkify/marketdesk/commit/7d2037208aa1eaa3532df6d190351b9782389adf))

<!-- legacy-entry:94 -->
* **olx:** prevent wrong category publish and guide quota-safe recreation ([#190](https://github.com/quokkify/marketdesk/issues/190)) ([4b097fa](https://github.com/quokkify/marketdesk/commit/4b097fa5044fff05286d7e789b31e014e5185ba6))

<!-- legacy-entry:95 -->
* **olx:** release failed update checkpoints ([#276](https://github.com/quokkify/marketdesk/issues/276)) ([3ff3bd1](https://github.com/quokkify/marketdesk/commit/3ff3bd1420965ac16b30f90b70135f4f85260ad4))

<!-- legacy-entry:96 -->
* **olx:** resolve paths from flat taxonomy ([#196](https://github.com/quokkify/marketdesk/issues/196)) ([28e3a53](https://github.com/quokkify/marketdesk/commit/28e3a53bd1adfc7598c093bc3fc365aae988bbf7))

<!-- legacy-entry:97 -->
* **olx:** stop treating phone views as messages ([#212](https://github.com/quokkify/marketdesk/issues/212)) ([42f8c86](https://github.com/quokkify/marketdesk/commit/42f8c86c055b5b7dbd7d21bc3eb73100d65b17f0))

<!-- legacy-entry:98 -->
* **olx:** sync owned advert images and statistics ([c073ee3](https://github.com/quokkify/marketdesk/commit/c073ee30a05c574784b02f0d2d9a2e2dd1a45665))

<!-- legacy-entry:99 -->
* **olx:** use account oauth for sync jobs ([#107](https://github.com/quokkify/marketdesk/issues/107)) ([fbf7b86](https://github.com/quokkify/marketdesk/commit/fbf7b8642b8b2b584956cbdece24c1b1b75057db))

<!-- legacy-entry:100 -->
* **olx:** use revision CAS for token refresh ([#187](https://github.com/quokkify/marketdesk/issues/187)) ([9d051ee](https://github.com/quokkify/marketdesk/commit/9d051eef7aa16da869aafeb05db21004188d8c78))

<!-- legacy-entry:101 -->
* **pricing:** allow intentional below-cost sales ([#101](https://github.com/quokkify/marketdesk/issues/101)) ([c05700a](https://github.com/quokkify/marketdesk/commit/c05700a2a8d162f4dae52f20a65bb9ecbd7f12bb))

<!-- legacy-entry:103 -->
* **product:** connect recommendations and marketplace status ([#163](https://github.com/quokkify/marketdesk/issues/163)) ([5f5f120](https://github.com/quokkify/marketdesk/commit/5f5f120ec407b7abc03ae85f877cef85675eb17b))

<!-- legacy-entry:104 -->
* **products:** repair details editing and layout ([#102](https://github.com/quokkify/marketdesk/issues/102)) ([596f1ec](https://github.com/quokkify/marketdesk/commit/596f1ec216c1e332e81bd8de3dfca6d4eb6da10a))

<!-- legacy-entry:105 -->
* **products:** require below-cost confirmation ([#184](https://github.com/quokkify/marketdesk/issues/184)) ([8ddff61](https://github.com/quokkify/marketdesk/commit/8ddff618283c56e4c57579a34ef7497ee2019c25))

<!-- legacy-entry:106 -->
* **products:** show listing titles in product previews ([#130](https://github.com/quokkify/marketdesk/issues/130)) ([d6be8dc](https://github.com/quokkify/marketdesk/commit/d6be8dc906236849f5b0717a0c007776df8befec))

<!-- legacy-entry:107 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **release:** anchor renamed component history ([#228](https://github.com/quokkify/marketdesk/issues/228)) ([c41c7f3](https://github.com/quokkify/marketdesk/commit/c41c7f3f4c6d17c08b7fe98a78d0d32f5dd55aa9))

<!-- legacy-entry:108 -->
* **release:** gate app startup on database migrations ([#217](https://github.com/quokkify/marketdesk/issues/217)) ([9e53a37](https://github.com/quokkify/marketdesk/commit/9e53a3709f09e3cec11954f55e1b43192303e8a4))

<!-- legacy-entry:109 -->
* **release:** use MarketDesk tag prefix ([#226](https://github.com/quokkify/marketdesk/issues/226)) ([9688f27](https://github.com/quokkify/marketdesk/commit/9688f27be27b5826fd3936184fcd8ebda62b1436))

<!-- legacy-entry:110 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **release:** use unprefixed release tags ([#291](https://github.com/quokkify/marketdesk/issues/291)) ([823a20b](https://github.com/quokkify/marketdesk/commit/823a20bde61e22309404d443faaa2851ee68b8b1))

<!-- legacy-entry:112 -->
* **security:** enforce strict CORS allowlist ([#80](https://github.com/quokkify/marketdesk/issues/80)) ([8840541](https://github.com/quokkify/marketdesk/commit/884054168c26c7ff2eb8ded01d06597dbc2e8ec7))

<!-- legacy-entry:113 -->
* **security:** enforce strict CORS production validation ([#86](https://github.com/quokkify/marketdesk/issues/86)) ([2c3bfac](https://github.com/quokkify/marketdesk/commit/2c3bfaca983eebedfba6fa3a65692ce10e07eb75))


## Legacy [0.19.2](https://github.com/ylazakovich/marketdesk/compare/marketdesk-v0.19.1...marketdesk-v0.19.2) (2026-07-23)

### 🐛 Bug Fixes

<!-- legacy-entry:119 -->
* **olx:** release failed update checkpoints ([#276](https://github.com/ylazakovich/marketdesk/issues/276)) ([3ff3bd1](https://github.com/ylazakovich/marketdesk/commit/3ff3bd1420965ac16b30f90b70135f4f85260ad4))


## Legacy [0.19.1](https://github.com/ylazakovich/marketdesk/compare/marketdesk-v0.19.0...marketdesk-v0.19.1) (2026-07-23)

### 🐛 Bug Fixes

<!-- legacy-entry:120 -->
* **hermes:** make listing SEO Apply update product and live listing ([#272](https://github.com/ylazakovich/marketdesk/issues/272)) ([5bbf9bc](https://github.com/ylazakovich/marketdesk/commit/5bbf9bcd8c8b0e771dff0a1a9d366adfb420010e))

<!-- legacy-entry:121 -->
* **migrations:** tolerate replayed conversations column ([#273](https://github.com/ylazakovich/marketdesk/issues/273)) ([7f6b7c6](https://github.com/ylazakovich/marketdesk/commit/7f6b7c6f870d46ec0ce2fa861bf8e2871de34637))

<!-- legacy-entry:122 -->
* **olx:** isolate per-listing sync failures ([#271](https://github.com/ylazakovich/marketdesk/issues/271)) ([6b4b599](https://github.com/ylazakovich/marketdesk/commit/6b4b59991155f7015b11084317b84d5dfd1b7f7a))


## Legacy [0.18.0](https://github.com/ylazakovich/marketdesk/compare/marketdesk-v0.17.3...marketdesk-v0.18.0) (2026-07-22)

### ✨ Features

<!-- legacy-entry:124 -->
* **hermes:** add product-scoped listing SEO analysis ([#263](https://github.com/ylazakovich/marketdesk/issues/263)) ([846beb3](https://github.com/ylazakovich/marketdesk/commit/846beb3eff7a0b27e05e9307dd72ce8fe4c9e05a))

<!-- legacy-entry:125 -->
* **olx:** add conversations metric ([#262](https://github.com/ylazakovich/marketdesk/issues/262)) ([d812b6d](https://github.com/ylazakovich/marketdesk/commit/d812b6de385f964fd178085e17708159b8bfdc0a))


## Legacy [0.17.3](https://github.com/ylazakovich/marketdesk/compare/marketdesk-v0.17.2...marketdesk-v0.17.3) (2026-07-22)

### 🐛 Bug Fixes

<!-- legacy-entry:126 -->
* **olx:** count messages from thread metadata ([#256](https://github.com/ylazakovich/marketdesk/issues/256)) ([29e4c68](https://github.com/ylazakovich/marketdesk/commit/29e4c68e01d27efc7e8547ac48dcc26a0fb90eda))


## Legacy [0.17.2](https://github.com/ylazakovich/marketdesk/compare/marketdesk-v0.17.1...marketdesk-v0.17.2) (2026-07-22)

### 🐛 Bug Fixes

<!-- legacy-entry:127 -->
* **analytics:** reconcile signed view baseline ([#253](https://github.com/ylazakovich/marketdesk/issues/253)) ([a2fc008](https://github.com/ylazakovich/marketdesk/commit/a2fc00885ab796950866e91d472c5799dc48f8a3))


## Legacy [0.17.1](https://github.com/ylazakovich/marketdesk/compare/marketdesk-v0.17.0...marketdesk-v0.17.1) (2026-07-22)

### 🐛 Bug Fixes

<!-- legacy-entry:128 -->
* **analytics:** restore legacy view baseline ([#249](https://github.com/ylazakovich/marketdesk/issues/249)) ([e552a8d](https://github.com/ylazakovich/marketdesk/commit/e552a8d2bc39ff172442bec76aa0ee5280d6cfc9))

### 🧹 Chores

<!-- legacy-entry:129 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** lock file maintenance ([#250](https://github.com/ylazakovich/marketdesk/issues/250)) ([d376aa4](https://github.com/ylazakovich/marketdesk/commit/d376aa467bbc3601bae51aaa6188808167a17fd8))


## Legacy [0.17.0](https://github.com/ylazakovich/marketdesk/compare/marketdesk-v0.16.0...marketdesk-v0.17.0) (2026-07-22)

### ✨ Features

<!-- legacy-entry:130 -->
* **analytics:** restore historical reporting ([#247](https://github.com/ylazakovich/marketdesk/issues/247)) ([36915a5](https://github.com/ylazakovich/marketdesk/commit/36915a5e4a4a15098052f0786d6af8caa339de28))

<!-- legacy-entry:131 -->
* **listings:** add safe delist-to-draft workflow ([#238](https://github.com/ylazakovich/marketdesk/issues/238)) ([57569be](https://github.com/ylazakovich/marketdesk/commit/57569beb72ee33178a592d3c68d1082f1dc7356d))

<!-- legacy-entry:132 -->
* **products:** add on-demand publication recheck ([#246](https://github.com/ylazakovich/marketdesk/issues/246)) ([446337b](https://github.com/ylazakovich/marketdesk/commit/446337bfb65abce9c452fe2c9834aa650937b748))

### 🐛 Bug Fixes

<!-- legacy-entry:133 -->
* **marketplace:** fence imports to token account revision ([#243](https://github.com/ylazakovich/marketdesk/issues/243)) ([eb5a3b5](https://github.com/ylazakovich/marketdesk/commit/eb5a3b578ad9d3a3736314e78097eb07f89c989b))

### 🧹 Chores

<!-- legacy-entry:134 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update @swc/core to v1.15.46 ([#245](https://github.com/ylazakovich/marketdesk/issues/245)) ([6f0f962](https://github.com/ylazakovich/marketdesk/commit/6f0f9624eee26bb3ccfd3f4e910c8d1d9eac86ee))

<!-- legacy-entry:135 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update express-rate-limit to v8.6.0 ([#242](https://github.com/ylazakovich/marketdesk/issues/242)) ([15790a0](https://github.com/ylazakovich/marketdesk/commit/15790a0f25b14ce27bf2b5c563b89b301fbc263c))

<!-- legacy-entry:136 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update minor and patch updates ([#244](https://github.com/ylazakovich/marketdesk/issues/244)) ([5ebb1c1](https://github.com/ylazakovich/marketdesk/commit/5ebb1c172c02b6fbbf3d717ace0c55897434ea07))

<!-- legacy-entry:137 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update vite to v8.1.5 ([#241](https://github.com/ylazakovich/marketdesk/issues/241)) ([27daf02](https://github.com/ylazakovich/marketdesk/commit/27daf027e9368120163131bae6149417592e4977))


## Legacy [0.15.0](https://github.com/ylazakovich/marketdesk/compare/marketdesk-v0.14.2...marketdesk-v0.15.0) (2026-07-18)

### ✨ Features

<!-- legacy-entry:139 -->
* **settings:** add persistent settings contracts ([#234](https://github.com/ylazakovich/marketdesk/issues/234)) ([dcc7f94](https://github.com/ylazakovich/marketdesk/commit/dcc7f94f150bf31295ebd80158be42d76c60afd8)), closes [#149](https://github.com/ylazakovich/marketdesk/issues/149)


## Legacy [0.14.2](https://github.com/ylazakovich/marketdesk/compare/marketdesk-v0.14.1...marketdesk-v0.14.2) (2026-07-18)

### 🧹 Chores

<!-- legacy-entry:141 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update github/codeql-action digest to 7188fc3 ([#225](https://github.com/ylazakovich/marketdesk/issues/225)) ([8fac1d0](https://github.com/ylazakovich/marketdesk/commit/8fac1d0650f772371fab07b4b5a4b7b71245a129))


## Legacy [0.14.0](https://github.com/ylazakovich/marketdesk/compare/marketdesk-v0.13.0...marketdesk-v0.14.0) (2026-07-18)

### ✨ Features

<!-- legacy-entry:143 -->
* **products:** redesign catalogue ([#223](https://github.com/ylazakovich/marketdesk/issues/223)) ([596102a](https://github.com/ylazakovich/marketdesk/commit/596102a11750e64a777911eb4d967b5a2e55d115))

### 🐛 Bug Fixes

<!-- legacy-entry:144 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **release:** anchor renamed component history ([#228](https://github.com/ylazakovich/marketdesk/issues/228)) ([c41c7f3](https://github.com/ylazakovich/marketdesk/commit/c41c7f3f4c6d17c08b7fe98a78d0d32f5dd55aa9))

<!-- legacy-entry:145 -->
* **release:** use MarketDesk tag prefix ([#226](https://github.com/ylazakovich/marketdesk/issues/226)) ([9688f27](https://github.com/ylazakovich/marketdesk/commit/9688f27be27b5826fd3936184fcd8ebda62b1436))


## Legacy [0.12.1](https://github.com/ylazakovich/marketdesk/compare/hermes-marketdesk-v0.12.0...hermes-marketdesk-v0.12.1) (2026-07-17)

### 🐛 Bug Fixes

<!-- legacy-entry:148 -->
* **release:** gate app startup on database migrations ([#217](https://github.com/ylazakovich/marketdesk/issues/217)) ([9e53a37](https://github.com/ylazakovich/marketdesk/commit/9e53a3709f09e3cec11954f55e1b43192303e8a4))


## Legacy [0.12.0](https://github.com/ylazakovich/marketdesk/compare/hermes-marketdesk-v0.11.1...hermes-marketdesk-v0.12.0) (2026-07-17)

### ✨ Features

<!-- legacy-entry:149 -->
* **sync:** reconcile product category provenance ([#214](https://github.com/ylazakovich/marketdesk/issues/214)) ([8de95e0](https://github.com/ylazakovich/marketdesk/commit/8de95e0c54634f7f717a03b51bfe46020a60831a))


## Legacy [0.11.1](https://github.com/ylazakovich/marketdesk/compare/hermes-marketdesk-v0.11.0...hermes-marketdesk-v0.11.1) (2026-07-17)

### 🐛 Bug Fixes

<!-- legacy-entry:150 -->
* **olx:** stop treating phone views as messages ([#212](https://github.com/ylazakovich/marketdesk/issues/212)) ([42f8c86](https://github.com/ylazakovich/marketdesk/commit/42f8c86c055b5b7dbd7d21bc3eb73100d65b17f0))


## Legacy [0.11.0](https://github.com/ylazakovich/marketdesk/compare/hermes-marketdesk-v0.10.1...hermes-marketdesk-v0.11.0) (2026-07-17)

### ✨ Features

<!-- legacy-entry:152 -->
* **listings:** confirm OLX quota override in publish review ([#202](https://github.com/ylazakovich/marketdesk/issues/202)) ([4627ed8](https://github.com/ylazakovich/marketdesk/commit/4627ed89a9b28f0f328e933dfac58cb3197c13b4))

<!-- legacy-entry:153 -->
* **settings:** show installed release version ([#211](https://github.com/ylazakovich/marketdesk/issues/211)) ([a10524f](https://github.com/ylazakovich/marketdesk/commit/a10524fea85c8cb5efa333291d1fa05e99eb80f4))

### 🐛 Bug Fixes

<!-- legacy-entry:154 -->
* **deploy:** initialize writable upload storage ([#206](https://github.com/ylazakovich/marketdesk/issues/206)) ([936cee1](https://github.com/ylazakovich/marketdesk/commit/936cee1397d77c18c0a5e1fbfc5926d74a350935))

<!-- legacy-entry:155 -->
* **deploy:** make database TLS mode explicit ([#205](https://github.com/ylazakovich/marketdesk/issues/205)) ([6169286](https://github.com/ylazakovich/marketdesk/commit/61692867515d2270d8db713b1c69cfebde7c1bdb))

### 📚 Documentation

<!-- legacy-entry:156 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deploy:** verify deleted uploads behind SPA fallback ([#208](https://github.com/ylazakovich/marketdesk/issues/208)) ([daf315f](https://github.com/ylazakovich/marketdesk/commit/daf315fee4bc6eb91f0bc8e17f3eeed80691d8bc))

### 🧪 Tests

<!-- legacy-entry:157 -->
* **olx:** cover production parent-id breadcrumbs ([#209](https://github.com/ylazakovich/marketdesk/issues/209)) ([c03b831](https://github.com/ylazakovich/marketdesk/commit/c03b83186c249c3e7a095cedad6afd8f405860f3))


## Legacy [0.10.1](https://github.com/ylazakovich/marketdesk/compare/hermes-marketdesk-v0.10.0...hermes-marketdesk-v0.10.1) (2026-07-16)

### 🐛 Bug Fixes

<!-- legacy-entry:158 -->
* **olx:** prevent wrong category publish and guide quota-safe recreation ([#190](https://github.com/ylazakovich/marketdesk/issues/190)) ([4b097fa](https://github.com/ylazakovich/marketdesk/commit/4b097fa5044fff05286d7e789b31e014e5185ba6))

<!-- legacy-entry:159 -->
* **olx:** resolve paths from flat taxonomy ([#196](https://github.com/ylazakovich/marketdesk/issues/196)) ([28e3a53](https://github.com/ylazakovich/marketdesk/commit/28e3a53bd1adfc7598c093bc3fc365aae988bbf7))


## Legacy [0.10.0](https://github.com/ylazakovich/hermes-marketdesk/compare/hermes-marketdesk-v0.9.0...hermes-marketdesk-v0.10.0) (2026-07-16)

### ✨ Features

<!-- legacy-entry:160 -->
* **hermes:** define canonical event lifecycle ([#186](https://github.com/ylazakovich/hermes-marketdesk/issues/186)) ([64d1a64](https://github.com/ylazakovich/hermes-marketdesk/commit/64d1a64e9b27f551222ab8adcff2d1832f1f3f83))

<!-- legacy-entry:161 -->
* **olx:** add quota-aware zero-spend publish guard ([#167](https://github.com/ylazakovich/hermes-marketdesk/issues/167)) ([14f6633](https://github.com/ylazakovich/hermes-marketdesk/commit/14f66334a4a2bf29f8a2e871ffae05cc6796cd48))

<!-- legacy-entry:163 -->
* **products:** add workspace image upload API ([#182](https://github.com/ylazakovich/hermes-marketdesk/issues/182)) ([be08fbe](https://github.com/ylazakovich/hermes-marketdesk/commit/be08fbe3764698bf71a23f3825b952e4255ee94f))

### 🐛 Bug Fixes

<!-- legacy-entry:165 -->
* **olx:** deliver applied Hermes changes to live adverts ([#168](https://github.com/ylazakovich/hermes-marketdesk/issues/168)) ([c920f12](https://github.com/ylazakovich/hermes-marketdesk/commit/c920f1222b017138034b1879bbaeb30227ebf80b))

<!-- legacy-entry:166 -->
* **olx:** use revision CAS for token refresh ([#187](https://github.com/ylazakovich/hermes-marketdesk/issues/187)) ([9d051ee](https://github.com/ylazakovich/hermes-marketdesk/commit/9d051eef7aa16da869aafeb05db21004188d8c78))

<!-- legacy-entry:168 -->
* **product:** connect recommendations and marketplace status ([#163](https://github.com/ylazakovich/hermes-marketdesk/issues/163)) ([5f5f120](https://github.com/ylazakovich/hermes-marketdesk/commit/5f5f120ec407b7abc03ae85f877cef85675eb17b))

<!-- legacy-entry:169 -->
* **products:** require below-cost confirmation ([#184](https://github.com/ylazakovich/hermes-marketdesk/issues/184)) ([8ddff61](https://github.com/ylazakovich/hermes-marketdesk/commit/8ddff618283c56e4c57579a34ef7497ee2019c25))

### 📚 Documentation

<!-- legacy-entry:172 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **architecture:** consolidate review decisions ([#185](https://github.com/ylazakovich/hermes-marketdesk/issues/185)) ([6fadcd6](https://github.com/ylazakovich/hermes-marketdesk/commit/6fadcd6a9922ceb412baca4cad3d8425da00188f))

<!-- legacy-entry:173 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **product:** restore PRD traceability gates ([#175](https://github.com/ylazakovich/hermes-marketdesk/issues/175)) ([952258a](https://github.com/ylazakovich/hermes-marketdesk/commit/952258af4d274bc4eba2afc32d90f1365250d488))


## Legacy [0.9.0](https://github.com/ylazakovich/hermes-marketdesk/compare/hermes-marketdesk-v0.8.0...hermes-marketdesk-v0.9.0) (2026-07-15)

### ✨ Features

<!-- legacy-entry:174 -->
* close MarketDesk product and AI tasks ([#162](https://github.com/ylazakovich/hermes-marketdesk/issues/162)) ([125081b](https://github.com/ylazakovich/hermes-marketdesk/commit/125081b9eb74fe03fb2a0fcaa66634808d1ee0f6))

### 🐛 Bug Fixes

<!-- legacy-entry:176 -->
* **olx:** sync owned advert images and statistics ([c073ee3](https://github.com/ylazakovich/hermes-marketdesk/commit/c073ee30a05c574784b02f0d2d9a2e2dd1a45665))


## Legacy [0.8.0](https://github.com/ylazakovich/hermes-marketdesk/compare/hermes-marketdesk-v0.7.0...hermes-marketdesk-v0.8.0) (2026-07-15)

### ✨ Features

<!-- legacy-entry:179 -->
* **olx:** import existing adverts ([#133](https://github.com/ylazakovich/hermes-marketdesk/issues/133)) ([7403716](https://github.com/ylazakovich/hermes-marketdesk/commit/74037161f96b53d83b16e84830b04d61d5d4d37b))

<!-- legacy-entry:180 -->
* store OLX app credentials per workspace ([#129](https://github.com/ylazakovich/hermes-marketdesk/issues/129)) ([18d1661](https://github.com/ylazakovich/hermes-marketdesk/commit/18d16610abdf7b3f2ff5a1b628e56b10d5522c2e))

### 🐛 Bug Fixes

<!-- legacy-entry:181 -->
* **hermes:** sync approved suggestions to listings ([#131](https://github.com/ylazakovich/hermes-marketdesk/issues/131)) ([a487049](https://github.com/ylazakovich/hermes-marketdesk/commit/a48704961e4cb927d7e6fd1925a74e580c5c8d46))

<!-- legacy-entry:182 -->
* **products:** show listing titles in product previews ([#130](https://github.com/ylazakovich/hermes-marketdesk/issues/130)) ([d6be8dc](https://github.com/ylazakovich/hermes-marketdesk/commit/d6be8dc906236849f5b0717a0c007776df8befec))

### 📚 Documentation

<!-- legacy-entry:183 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deployment:** add Caddy + Cloudflare VPS setup guide ([#134](https://github.com/ylazakovich/hermes-marketdesk/issues/134)) ([a199530](https://github.com/ylazakovich/hermes-marketdesk/commit/a199530411bb66bba051d12cabc3636549684aff))

### 🧹 Chores

<!-- legacy-entry:184 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** lock file maintenance ([#136](https://github.com/ylazakovich/hermes-marketdesk/issues/136)) ([b90bbe9](https://github.com/ylazakovich/hermes-marketdesk/commit/b90bbe99a182728662166589e2c7a9220cd4ea52))

<!-- legacy-entry:185 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update minor and patch updates ([#135](https://github.com/ylazakovich/hermes-marketdesk/issues/135)) ([4bf3af5](https://github.com/ylazakovich/hermes-marketdesk/commit/4bf3af5c866c0d0fc426364067ada76b1bacd412))


## Legacy [0.7.0](https://github.com/ylazakovich/hermes-marketdesk/compare/hermes-marketdesk-v0.6.0...hermes-marketdesk-v0.7.0) (2026-07-15)

### ✨ Features

<!-- legacy-entry:186 -->
* **olx:** preview owned advert imports ([#119](https://github.com/ylazakovich/hermes-marketdesk/issues/119)) ([6b4ac91](https://github.com/ylazakovich/hermes-marketdesk/commit/6b4ac91494610c46c171f75df72e1da0eb3327e8))

### 🐛 Bug Fixes

<!-- legacy-entry:188 -->
* **hermes:** allow dismiss without request body ([#116](https://github.com/ylazakovich/hermes-marketdesk/issues/116)) ([0317a53](https://github.com/ylazakovich/hermes-marketdesk/commit/0317a5340b77d39cf146be1dc8b489628d5cda45))

<!-- legacy-entry:190 -->
* **listings:** show product identity in listings ([#124](https://github.com/ylazakovich/hermes-marketdesk/issues/124)) ([4decc6f](https://github.com/ylazakovich/hermes-marketdesk/commit/4decc6fa411a3a2ad5911746d4722a3368e9deba))

<!-- legacy-entry:191 -->
* **olx:** map live engagement counters ([#125](https://github.com/ylazakovich/hermes-marketdesk/issues/125)) ([7d20372](https://github.com/ylazakovich/hermes-marketdesk/commit/7d2037208aa1eaa3532df6d190351b9782389adf))


## Legacy [0.6.0](https://github.com/ylazakovich/hermes-marketdesk/compare/hermes-marketdesk-v0.5.0...hermes-marketdesk-v0.6.0) (2026-07-15)

### ✨ Features

<!-- legacy-entry:192 -->
* **listings:** expose canonical marketplace links ([#111](https://github.com/ylazakovich/hermes-marketdesk/issues/111)) ([e7d086d](https://github.com/ylazakovich/hermes-marketdesk/commit/e7d086da187f9852e9294e17616c9769fe64533a))

<!-- legacy-entry:193 -->
* **olx:** add import preview foundation ([#112](https://github.com/ylazakovich/hermes-marketdesk/issues/112)) ([83a1006](https://github.com/ylazakovich/hermes-marketdesk/commit/83a1006fa8ac91fbdf5aaaa7de78926f29b2978a))

<!-- legacy-entry:194 -->
* **olx:** add OAuth and guarded real publishing ([#93](https://github.com/ylazakovich/hermes-marketdesk/issues/93)) ([a13125f](https://github.com/ylazakovich/hermes-marketdesk/commit/a13125fc2ce00fdb93501d9d4bcb434629ce465e))

<!-- legacy-entry:195 -->
* **olx:** preserve unavailable engagement metrics ([#110](https://github.com/ylazakovich/hermes-marketdesk/issues/110)) ([d73402d](https://github.com/ylazakovich/hermes-marketdesk/commit/d73402de67f88a06cd2a71576802f391bdc0b4bc))

<!-- legacy-entry:196 -->
* **olx:** reconcile remote advert statuses ([#108](https://github.com/ylazakovich/hermes-marketdesk/issues/108)) ([6a55338](https://github.com/ylazakovich/hermes-marketdesk/commit/6a55338c927a63b27a2330cc58fcfb9d143655f7))

<!-- legacy-entry:197 -->
* **sync:** schedule marketplace sync modes safely ([#109](https://github.com/ylazakovich/hermes-marketdesk/issues/109)) ([6f06a5f](https://github.com/ylazakovich/hermes-marketdesk/commit/6f06a5f8e551778b5f1261979e453578e0598b3d))

### 🐛 Bug Fixes

<!-- legacy-entry:199 -->
* **analytics:** show readable listing identity ([#105](https://github.com/ylazakovich/hermes-marketdesk/issues/105)) ([c93ad34](https://github.com/ylazakovich/hermes-marketdesk/commit/c93ad34afbbee2fda7a94ed05a5cb4b989687356))

<!-- legacy-entry:200 -->
* **listings:** hide draft external urls ([#113](https://github.com/ylazakovich/hermes-marketdesk/issues/113)) ([3874f07](https://github.com/ylazakovich/hermes-marketdesk/commit/3874f071747cba9ddb6e8c58f9bc7781d1d2ff54))

<!-- legacy-entry:202 -->
* **olx:** use account oauth for sync jobs ([#107](https://github.com/ylazakovich/hermes-marketdesk/issues/107)) ([fbf7b86](https://github.com/ylazakovich/hermes-marketdesk/commit/fbf7b8642b8b2b584956cbdece24c1b1b75057db))

<!-- legacy-entry:203 -->
* **pricing:** allow intentional below-cost sales ([#101](https://github.com/ylazakovich/hermes-marketdesk/issues/101)) ([c05700a](https://github.com/ylazakovich/hermes-marketdesk/commit/c05700a2a8d162f4dae52f20a65bb9ecbd7f12bb))

<!-- legacy-entry:204 -->
* **products:** repair details editing and layout ([#102](https://github.com/ylazakovich/hermes-marketdesk/issues/102)) ([596f1ec](https://github.com/ylazakovich/hermes-marketdesk/commit/596f1ec216c1e332e81bd8de3dfca6d4eb6da10a))

<!-- legacy-entry:205 -->
* **security:** enforce strict CORS production validation ([#86](https://github.com/ylazakovich/hermes-marketdesk/issues/86)) ([2c3bfac](https://github.com/ylazakovich/hermes-marketdesk/commit/2c3bfaca983eebedfba6fa3a65692ce10e07eb75))

### ⚙️ CI

<!-- legacy-entry:207 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **release:** add emoji headings in release changelog ([#84](https://github.com/ylazakovich/hermes-marketdesk/issues/84)) ([1e5fda1](https://github.com/ylazakovich/hermes-marketdesk/commit/1e5fda1626a28dd057238b3e799ae52adafdf97e))


## Legacy [0.5.0](https://github.com/ylazakovich/hermes-marketdesk/compare/hermes-marketdesk-v0.4.1...hermes-marketdesk-v0.5.0) (2026-07-14)

### Features

<!-- legacy-entry:208 -->
* **olx:** prepare real API transport ([#79](https://github.com/ylazakovich/hermes-marketdesk/issues/79)) ([ee64067](https://github.com/ylazakovich/hermes-marketdesk/commit/ee640670bdb93bba434740fc34cd44eb37946133))

### Chores

<!-- legacy-entry:209 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update actions/setup-node action to v7 ([#83](https://github.com/ylazakovich/hermes-marketdesk/issues/83)) ([5217bc5](https://github.com/ylazakovich/hermes-marketdesk/commit/5217bc5ff02996655266e60ed87ab76a8ccce54e))


## Legacy [0.4.1](https://github.com/ylazakovich/hermes-marketdesk/compare/hermes-marketdesk-v0.4.0...hermes-marketdesk-v0.4.1) (2026-07-13)

### Bug Fixes

<!-- legacy-entry:210 -->
* **security:** enforce strict CORS allowlist ([#80](https://github.com/ylazakovich/hermes-marketdesk/issues/80)) ([8840541](https://github.com/ylazakovich/hermes-marketdesk/commit/884054168c26c7ff2eb8ded01d06597dbc2e8ec7))


## Legacy [0.4.0](https://github.com/ylazakovich/hermes-marketdesk/compare/hermes-marketdesk-v0.3.1...hermes-marketdesk-v0.4.0) (2026-07-13)

### Features

<!-- legacy-entry:211 -->
* **auth:** provision OLX marketplace for new workspaces ([#75](https://github.com/ylazakovich/hermes-marketdesk/issues/75)) ([8449d75](https://github.com/ylazakovich/hermes-marketdesk/commit/8449d7597bc3e091092f584cbaedfa7da6a89c81))

<!-- legacy-entry:212 -->
* **listings:** add publish preview dry run ([#77](https://github.com/ylazakovich/hermes-marketdesk/issues/77)) ([d096106](https://github.com/ylazakovich/hermes-marketdesk/commit/d0961064639e5667322144a124878e6db00b5e91))

<!-- legacy-entry:213 -->
* **listings:** create draft listings from products ([#76](https://github.com/ylazakovich/hermes-marketdesk/issues/76)) ([22cbcd6](https://github.com/ylazakovich/hermes-marketdesk/commit/22cbcd6378ce520116f5a3941ad187f3c9ba976e))


## Legacy [0.3.1](https://github.com/ylazakovich/hermes-marketdesk/compare/hermes-marketdesk-v0.3.0...hermes-marketdesk-v0.3.1) (2026-07-13)

### Bug Fixes

<!-- legacy-entry:215 -->
* **docker:** restore runtime after upgrades ([#74](https://github.com/ylazakovich/hermes-marketdesk/issues/74)) ([e244388](https://github.com/ylazakovich/hermes-marketdesk/commit/e244388bc99eaa518d61cb18939c1dcb79131c8d))

### Documentation

<!-- legacy-entry:216 -->
_Shared/legacy provenance (archived here, not backend-only):_

* move design artifacts under docs ([#64](https://github.com/ylazakovich/hermes-marketdesk/issues/64)) ([b2bad3c](https://github.com/ylazakovich/hermes-marketdesk/commit/b2bad3caa9b511006667aaf5a011ca4d2237a25f))

<!-- legacy-entry:217 -->
_Shared/legacy provenance (archived here, not backend-only):_

* move screenshots into design docs ([#68](https://github.com/ylazakovich/hermes-marketdesk/issues/68)) ([6de4669](https://github.com/ylazakovich/hermes-marketdesk/commit/6de46699a559e9ac1e0b063d77a8efe697c83923))

### Chores

<!-- legacy-entry:218 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** lock file maintenance ([#73](https://github.com/ylazakovich/hermes-marketdesk/issues/73)) ([0f5ebb1](https://github.com/ylazakovich/hermes-marketdesk/commit/0f5ebb180389ba5bb255478b7994d71633f2bd03))

<!-- legacy-entry:219 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** pin dependencies ([#67](https://github.com/ylazakovich/hermes-marketdesk/issues/67)) ([0ede209](https://github.com/ylazakovich/hermes-marketdesk/commit/0ede209c4b30e9d7bf34f83aad70ec9efccc76f7))

<!-- legacy-entry:220 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** pin dependencies ([#69](https://github.com/ylazakovich/hermes-marketdesk/issues/69)) ([c216828](https://github.com/ylazakovich/hermes-marketdesk/commit/c2168286d050ca6ee468992b45f73fe10c5239d2))

<!-- legacy-entry:221 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** pin dependencies ([#70](https://github.com/ylazakovich/hermes-marketdesk/issues/70)) ([8d9e5bd](https://github.com/ylazakovich/hermes-marketdesk/commit/8d9e5bdaa942c4ffdca1155a52f170836016f222))

<!-- legacy-entry:222 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** pin dependencies ([#72](https://github.com/ylazakovich/hermes-marketdesk/issues/72)) ([55c775e](https://github.com/ylazakovich/hermes-marketdesk/commit/55c775e96d7c098f2c71937914890b75e9cf794d))

<!-- legacy-entry:223 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update @babel/plugin-transform-runtime to v8 ([#71](https://github.com/ylazakovich/hermes-marketdesk/issues/71)) ([1c54f9c](https://github.com/ylazakovich/hermes-marketdesk/commit/1c54f9c563f8110744f27074d8ce3069118e7a45))

<!-- legacy-entry:224 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update @types/uuid to v11 ([#66](https://github.com/ylazakovich/hermes-marketdesk/issues/66)) ([6cf0de6](https://github.com/ylazakovich/hermes-marketdesk/commit/6cf0de6a42eed28af236a165ed6655495a279c0b))

<!-- legacy-entry:225 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update @vitejs/plugin-react to v6 ([5915dae](https://github.com/ylazakovich/hermes-marketdesk/commit/5915daee792d16cfc9aabc628020ce92bb6727fc))

<!-- legacy-entry:226 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update tsx to v4.23.1 ([#25](https://github.com/ylazakovich/hermes-marketdesk/issues/25)) ([bb8dbfa](https://github.com/ylazakovich/hermes-marketdesk/commit/bb8dbfad5632167ebc8f21e19edb3c66b5a70ab7))


## Legacy [0.3.0](https://github.com/ylazakovich/hermes-marketdesk/compare/hermes-marketdesk-v0.2.1...hermes-marketdesk-v0.3.0) (2026-07-12)

### Features

<!-- legacy-entry:228 -->
* **hermes:** use native agent API for AI suggestions ([#8](https://github.com/ylazakovich/hermes-marketdesk/issues/8)) ([b34b724](https://github.com/ylazakovich/hermes-marketdesk/commit/b34b724dae735644f691933743dd701c24401225))

### Bug Fixes

<!-- legacy-entry:229 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** replace react-query with @tanstack/react-query ^4.0.5 ([#12](https://github.com/ylazakovich/hermes-marketdesk/issues/12)) ([cf28b99](https://github.com/ylazakovich/hermes-marketdesk/commit/cf28b993bfae86535dc799f433e11fce50bc5b74))

<!-- legacy-entry:231 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update @tanstack/react-query to v5 ([#33](https://github.com/ylazakovich/hermes-marketdesk/issues/33)) ([6650716](https://github.com/ylazakovich/hermes-marketdesk/commit/6650716eb0a0d43d2f8137f1d2da2e05b21555c6))

<!-- legacy-entry:232 -->
* **deps:** update bcryptjs to v3 ([#13](https://github.com/ylazakovich/hermes-marketdesk/issues/13)) ([93cf0db](https://github.com/ylazakovich/hermes-marketdesk/commit/93cf0db6a44b44dbfad5ceb28a4de44672a720a6))

<!-- legacy-entry:233 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update date-fns to v3 ([#22](https://github.com/ylazakovich/hermes-marketdesk/issues/22)) ([f78459e](https://github.com/ylazakovich/hermes-marketdesk/commit/f78459eb3f714258c0d16fbc45e845249399a738))

<!-- legacy-entry:234 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update date-fns to v4 ([#34](https://github.com/ylazakovich/hermes-marketdesk/issues/34)) ([f9140dd](https://github.com/ylazakovich/hermes-marketdesk/commit/f9140ddab5331d057417d9a028615453a37caff4))

<!-- legacy-entry:235 -->
* **deps:** update dotenv to v17 ([#14](https://github.com/ylazakovich/hermes-marketdesk/issues/14)) ([4858fbd](https://github.com/ylazakovich/hermes-marketdesk/commit/4858fbd52c120afc93a5a77cfe9b17ee79e241e6))

<!-- legacy-entry:236 -->
* **deps:** update express to v5 ([#41](https://github.com/ylazakovich/hermes-marketdesk/issues/41)) ([a56181d](https://github.com/ylazakovich/hermes-marketdesk/commit/a56181d0035cf2ea6faa677247d16d7f753fa235))

<!-- legacy-entry:237 -->
* **deps:** update express-rate-limit to v8 ([#15](https://github.com/ylazakovich/hermes-marketdesk/issues/15)) ([07d0c0b](https://github.com/ylazakovich/hermes-marketdesk/commit/07d0c0bcff466051dbd7e8fd33cae2a911454b2a))

<!-- legacy-entry:238 -->
* **deps:** update helmet to v8 ([#16](https://github.com/ylazakovich/hermes-marketdesk/issues/16)) ([bbf27aa](https://github.com/ylazakovich/hermes-marketdesk/commit/bbf27aa886c73855312931f02bd99cb21f5ecf3b))

<!-- legacy-entry:239 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update joi to v18 ([#35](https://github.com/ylazakovich/hermes-marketdesk/issues/35)) ([7641272](https://github.com/ylazakovich/hermes-marketdesk/commit/7641272c464a7e233be6e99f6b142901d859ce3f))

<!-- legacy-entry:241 -->
* **deps:** update pino to v10 ([#42](https://github.com/ylazakovich/hermes-marketdesk/issues/42)) ([351089b](https://github.com/ylazakovich/hermes-marketdesk/commit/351089b49cb436089bc4c2f0a99e02cd12d85376))

<!-- legacy-entry:242 -->
* **deps:** update pino to v9 ([#17](https://github.com/ylazakovich/hermes-marketdesk/issues/17)) ([789031e](https://github.com/ylazakovich/hermes-marketdesk/commit/789031e9b2365dc4fc0c56d443c6c37e0c64e0bb))

<!-- legacy-entry:243 -->
* **deps:** update pino-pretty to v11 ([#23](https://github.com/ylazakovich/hermes-marketdesk/issues/23)) ([fef926a](https://github.com/ylazakovich/hermes-marketdesk/commit/fef926ab52a6070a6590159e98a96737aebf93a9))

<!-- legacy-entry:244 -->
* **deps:** update pino-pretty to v12 ([#37](https://github.com/ylazakovich/hermes-marketdesk/issues/37)) ([1f85a92](https://github.com/ylazakovich/hermes-marketdesk/commit/1f85a92e068f859fec0f13783ea6fa6a9f268af2))

<!-- legacy-entry:245 -->
* **deps:** update pino-pretty to v13 ([#43](https://github.com/ylazakovich/hermes-marketdesk/issues/43)) ([bec1424](https://github.com/ylazakovich/hermes-marketdesk/commit/bec1424963a52326194a29d69aeb39ade4b68d8d))

<!-- legacy-entry:250 -->
* **deps:** update redis to v5 ([#30](https://github.com/ylazakovich/hermes-marketdesk/issues/30)) ([6e53d21](https://github.com/ylazakovich/hermes-marketdesk/commit/6e53d21a86952da2dd2fdbc14da76b660db39a7d))

<!-- legacy-entry:251 -->
* **deps:** update redis to v6 ([#38](https://github.com/ylazakovich/hermes-marketdesk/issues/38)) ([1b93815](https://github.com/ylazakovich/hermes-marketdesk/commit/1b938157f41c759852e0896018ee86aef545be0e))

<!-- legacy-entry:252 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update redux to v5 ([#31](https://github.com/ylazakovich/hermes-marketdesk/issues/31)) ([23740f3](https://github.com/ylazakovich/hermes-marketdesk/commit/23740f38190b93c1d3c6d3d3a8632139959b64aa))

<!-- legacy-entry:253 -->
* **deps:** update uuid to v11 [security] ([#11](https://github.com/ylazakovich/hermes-marketdesk/issues/11)) ([1ead758](https://github.com/ylazakovich/hermes-marketdesk/commit/1ead758c930589a52ef1d0f6092a4461e672392c))

<!-- legacy-entry:254 -->
* **deps:** update uuid to v12 ([#45](https://github.com/ylazakovich/hermes-marketdesk/issues/45)) ([0ae38f7](https://github.com/ylazakovich/hermes-marketdesk/commit/0ae38f70f134d17c87cbf40724d752f068832d35))

<!-- legacy-entry:255 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update uuid to v14 ([#50](https://github.com/ylazakovich/hermes-marketdesk/issues/50)) ([8acd36f](https://github.com/ylazakovich/hermes-marketdesk/commit/8acd36faa89357d49ac1e8e405fb6e12652833dc))

<!-- legacy-entry:256 -->
* **deps:** update zod to v4 ([#18](https://github.com/ylazakovich/hermes-marketdesk/issues/18)) ([4348867](https://github.com/ylazakovich/hermes-marketdesk/commit/4348867b68ce214f296b52bfc7ac1343e9f0dda5))

### CI

<!-- legacy-entry:257 -->
_Shared/legacy provenance (archived here, not backend-only):_

* enforce Node 22 runtime ([#32](https://github.com/ylazakovich/hermes-marketdesk/issues/32)) ([1f8a09f](https://github.com/ylazakovich/hermes-marketdesk/commit/1f8a09f71bd3e2580578bed6b13e1c10a19accb5))

### Chores

<!-- legacy-entry:258 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** lock file maintenance ([#39](https://github.com/ylazakovich/hermes-marketdesk/issues/39)) ([4ef7233](https://github.com/ylazakovich/hermes-marketdesk/commit/4ef7233caca9bbf0fa5b1b875046ad9ed5d02c57))

<!-- legacy-entry:259 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** pin allure-jest to 3.10.2 ([#52](https://github.com/ylazakovich/hermes-marketdesk/issues/52)) ([71804c3](https://github.com/ylazakovich/hermes-marketdesk/commit/71804c329b0179f0e4963262ed3c8a8f693e6e5e))

<!-- legacy-entry:260 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update @types/supertest to v7 ([#53](https://github.com/ylazakovich/hermes-marketdesk/issues/53)) ([59b9165](https://github.com/ylazakovich/hermes-marketdesk/commit/59b91650dae682cc58c8367d3602c500ce80c8f4))

<!-- legacy-entry:261 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update @vitejs/plugin-react to v5 ([#19](https://github.com/ylazakovich/hermes-marketdesk/issues/19)) ([b4e9c6b](https://github.com/ylazakovich/hermes-marketdesk/commit/b4e9c6ba2b105e36b3caac42ea65cfe9bbf5e7ea))

<!-- legacy-entry:262 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update actions/upload-artifact action to v7 ([#47](https://github.com/ylazakovich/hermes-marketdesk/issues/47)) ([142fffd](https://github.com/ylazakovich/hermes-marketdesk/commit/142fffd4974f8d22566fb8b4f898e57e604395d9))

<!-- legacy-entry:263 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update concurrently to v10 ([#51](https://github.com/ylazakovich/hermes-marketdesk/issues/51)) ([e011028](https://github.com/ylazakovich/hermes-marketdesk/commit/e01102860b547bc7e8419126ebcc845004af5f08))

<!-- legacy-entry:264 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update concurrently to v9 ([#20](https://github.com/ylazakovich/hermes-marketdesk/issues/20)) ([73cb7b2](https://github.com/ylazakovich/hermes-marketdesk/commit/73cb7b27cefa213b22c7e448eb2aab9624c4a58c))

<!-- legacy-entry:265 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update docker-compose to v1 ([#55](https://github.com/ylazakovich/hermes-marketdesk/issues/55)) ([42a260a](https://github.com/ylazakovich/hermes-marketdesk/commit/42a260aa03081012339bd850b87bafb93d7b0e6f))

<!-- legacy-entry:266 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update eslint to v10 ([#48](https://github.com/ylazakovich/hermes-marketdesk/issues/48)) ([de3b600](https://github.com/ylazakovich/hermes-marketdesk/commit/de3b6000293121e588b1a4fefd6245d9a7fc53cf))

<!-- legacy-entry:267 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update eslint to v9 ([#40](https://github.com/ylazakovich/hermes-marketdesk/issues/40)) ([ba88b73](https://github.com/ylazakovich/hermes-marketdesk/commit/ba88b73d00af1b582ab9a1c60cb3959b031280c9))

<!-- legacy-entry:268 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update github-actions to v8 ([#46](https://github.com/ylazakovich/hermes-marketdesk/issues/46)) ([589d551](https://github.com/ylazakovich/hermes-marketdesk/commit/589d5516e625df8e49c74f74db10a3b711f84789))

<!-- legacy-entry:269 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update jest monorepo to v30 ([#56](https://github.com/ylazakovich/hermes-marketdesk/issues/56)) ([01be88d](https://github.com/ylazakovich/hermes-marketdesk/commit/01be88d78f94530f9585d34c544ea566fced2b92))

<!-- legacy-entry:270 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update node.js to v22 ([#26](https://github.com/ylazakovich/hermes-marketdesk/issues/26)) ([9007422](https://github.com/ylazakovich/hermes-marketdesk/commit/9007422a3d353de0d79fdaff978a7aaf4df7791a))

<!-- legacy-entry:271 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update node.js to v24 ([#57](https://github.com/ylazakovich/hermes-marketdesk/issues/57)) ([4b81d93](https://github.com/ylazakovich/hermes-marketdesk/commit/4b81d93c08ecfb6ff903c9597884b0b5603fce53))

<!-- legacy-entry:272 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update postgres docker tag to v16 ([#27](https://github.com/ylazakovich/hermes-marketdesk/issues/27)) ([0e1575a](https://github.com/ylazakovich/hermes-marketdesk/commit/0e1575afef165389692c1cda14dcf45c62043b39))

<!-- legacy-entry:273 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update postgres docker tag to v18 ([#49](https://github.com/ylazakovich/hermes-marketdesk/issues/49)) ([0215e63](https://github.com/ylazakovich/hermes-marketdesk/commit/0215e63964e974aa9eab8557ec563a286e3dc4fc))

<!-- legacy-entry:274 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update postgres docker tag to v18 ([#58](https://github.com/ylazakovich/hermes-marketdesk/issues/58)) ([9542c39](https://github.com/ylazakovich/hermes-marketdesk/commit/9542c395f338400744b4df66b85cdd670fe9e6f4))

<!-- legacy-entry:275 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update redis docker tag to v8 ([#59](https://github.com/ylazakovich/hermes-marketdesk/issues/59)) ([13595b4](https://github.com/ylazakovich/hermes-marketdesk/commit/13595b493ee67fa84a9f6bbd586b9893b5c5001b))

<!-- legacy-entry:276 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update typescript-eslint monorepo to v8 ([#21](https://github.com/ylazakovich/hermes-marketdesk/issues/21)) ([a2546ac](https://github.com/ylazakovich/hermes-marketdesk/commit/a2546acdf1349f2dbc7900e2e765de9004bdaed5))

<!-- legacy-entry:277 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update vite to v6 [security] ([#10](https://github.com/ylazakovich/hermes-marketdesk/issues/10)) ([907dacb](https://github.com/ylazakovich/hermes-marketdesk/commit/907dacb6740b7f223f562846caeac9c7e0c452f1))


## Legacy [0.2.1](https://github.com/ylazakovich/hermes-marketdesk/compare/hermes-marketdesk-v0.2.0...hermes-marketdesk-v0.2.1) (2026-07-12)

### CI

<!-- legacy-entry:279 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **renovate:** enforce conventional dependency PR titles ([#7](https://github.com/ylazakovich/hermes-marketdesk/issues/7)) ([b269191](https://github.com/ylazakovich/hermes-marketdesk/commit/b2691913d732f3c4ea2352d59d22d2bef355c516))

### Chores

<!-- legacy-entry:280 -->
_Shared/legacy provenance (archived here, not backend-only):_

* **deps:** update docker-compose to ^0.24.0 ([#3](https://github.com/ylazakovich/hermes-marketdesk/issues/3)) ([571c757](https://github.com/ylazakovich/hermes-marketdesk/commit/571c757a3ac0b99fafee743e22dd24aa597c8946))


## Legacy [0.2.0](https://github.com/ylazakovich/hermes-marketdesk/compare/hermes-marketdesk-v0.1.0...hermes-marketdesk-v0.2.0) (2026-07-12)

### Features

<!-- legacy-entry:281 -->
* implement MarketDesk multi-marketplace SaaS platform ([#1](https://github.com/ylazakovich/hermes-marketdesk/issues/1)) ([2259d71](https://github.com/ylazakovich/hermes-marketdesk/commit/2259d71d96ac742ad5eb07a5b97bada6915de88b))
