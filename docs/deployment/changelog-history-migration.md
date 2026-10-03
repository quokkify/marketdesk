# Component changelog migration audit

## Authority and conservation

The active histories are [backend](../../src/backend/CHANGELOG-backend.md),
[frontend](../../src/frontend/CHANGELOG-frontend.md), and
[assets](../../public/CHANGELOG-assets.md). Release Please's manifest and component
paths remain the authority for future bumps. There is no fourth root release stream.

The source is the Git blob `d3b42199d57f12fc6df20d3ba241ae63b51081c4:CHANGELOG.md`:
65,749 bytes, SHA-256
`739bfbdc60f75bbbfd0ecf11c18fdf33ba6b2b5069476a48c428616546d9c4a2`.
Its exact backup and the read-only release/tag snapshots are outside the PR in
`/home/yaraslau/.hermes/profiles/codex-worker/cache/scratch/t_461cde0c/`.
The source remains recoverable from Git history, not a generated root changelog.

[changelog-history-audit.json](changelog-history-audit.json) is an immutable
migration fixture, not a release feed. It records every source entry's exact text,
SHA-256, section/date/original tag URL, commit changed paths, dependency-import
proof, destinations and overlap identity. `legacy-entry:N` comments connect each
rendered occurrence to that fixture. The verifier compares the fixture against the
original Git blob, checks every non-whitespace source block, and checks exact
occurrence counts and category/version placement in the component documents.

Verified inventory:

- 33 original version sections, newest-first by their recorded dates.
- 282 source bullet occurrences, referencing 168 unique commits.
- 114 repeated-commit occurrences, retained explicitly as inherited snapshots,
  not counted as new component releases.
- Backend: 225 occurrences; frontend: 116; assets: 2. The extra occurrences are
  intentional cross-component assignments, not accidental duplicate migration.
- 66 shared-only occurrences archived once in the backend history with explicit
  shared/legacy labels; this does not claim they were backend-only changes.
- One original rich block retained byte-for-byte in backend and frontend, justified
  by PR #311's commit touching both component paths. Its three screenshots already
  use absolute, immutable raw-content URLs, so moving the block does not rebase them.

## Assignment rules and historical anomalies

Assignments use `git show --format= --name-only` on every linked source commit,
not title matching. Changes under `src/backend/`, `src/frontend/` and `public/`
go to those components. Root runtime dependency changes also follow their actual
source importers at that commit: the fixture records the changed package and each
matching source path. Cross-cutting changes can appear in multiple histories.
Other paths remain visible in the provenance fixture. Tooling, CI, documentation,
build and lockfile-only work without a component path/importer is shared history,
archived once with backend rather than copied into all three documents. For
example, React/MUI dependency entries follow frontend importers, while root-only
release configuration changes remain explicitly shared.

The 2026-09-25 `v1.0.0` release was a combined-stream bootstrap containing already
released work. Its 114 entries and original September date remain visible as a
legacy snapshot, ahead of the July releases. Neither it nor any other legacy
heading represents an independently published backend/frontend/assets release.
The original `hermes-marketdesk-*`, `marketdesk-*`, and `v1.0.0` tags and old
repository links remain authoritative and have not been moved or rewritten.

All actual 0.21.0 release bullets, dates and versions are preserved. The only
correction to their top sections is the starting compare ref: the generated
`backend-v0.20.0`, `frontend-v0.20.0`, and `assets-v0.20.0` refs do not exist in the
live tag inventory. Their links now start at the real combined
`marketdesk-v0.20.0` tag and end at the existing component 0.21.0 tag. No component
baseline/version is changed and no historical component tag is invented.

There are no tracked component `version.txt` files at the source revision; the
manifest records the current component versions. The root package version is not
converted into a fourth stream. Assets remain packaged by the explicit Dockerfile
COPY list; historical screenshots/docs are not shipped as runtime asset images.

## GitHub display order is not the latest designation

Read-only observations on 2026-10-03:

| Tag | Release ID | created_at (UTC) | published_at (UTC) |
| --- | --- | --- | --- |
| marketdesk-v0.20.0 | 402432199 | 09:20:04 | 09:20:24 |
| backend-v0.21.0 | 402587235 | 16:08:57 | 16:09:15 |
| frontend-v0.21.0 | 402587241 | 16:08:57 | 16:09:16 |
| assets-v0.21.0 | 402587247 | 16:08:57 | 16:09:17 |
| v1.0.0 | 396396027 | 2026-09-25 07:25:56 | 2026-09-25 07:26:16 |

The REST list and the owner's screenshot put `marketdesk-v0.20.0` first, then
frontend/backend/assets 0.21.0. However, `/releases/latest` returns
`assets-v0.21.0` (402587247), and GraphQL `isLatest` agrees. An explicit GraphQL
`orderBy: {field: CREATED_AT, direction: DESC}` instead returns the three 0.21.0
releases before 0.20.0. The legacy release's `updated_at` is 16:14:59, after the
component publication times; this is an observation, not proof of an undocumented
sorting rule. The list endpoint exposes no documented sort parameter. Do not
infer its ordering from the latest badge, semantic version magnitude, or a
chosen component sequence.

Primary GitHub contracts:

- [REST latest](https://docs.github.com/en/rest/releases/releases#get-the-latest-release):
  documents `created_at` as the commit date, not draft/publication time.
- [Release update](https://docs.github.com/en/rest/releases/releases#update-a-release):
  `make_latest` is a latest-designation control; `legacy` uses creation date and
  higher semantic version. It is not a documented arbitrary list-order control.
- [Managing releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository):
  explains selecting "Set as latest release" independently of release notes.

The project uses toolkit `v2.24.0` in manifest mode, with Release Please Action
`45996ed1f6d02564a971a2fa1b5860e934307cf7` (5.0.0; lockfile pins release-please
17.6.0). The reusable workflow has no `make_latest` input or component creation
ordering contract. Project-local enrichment updates release PRs, not published
GitHub Release metadata. No workflow change is added to promise an unsupported
UI order. Native generation owns the next bump; enrichment only rebuilds current
version blocks and never republishes the inherited history.

## Proposed metadata-only follow-up — owner approval required

No release metadata was changed by this PR. A safe owner-approved follow-up can:

1. Re-read the exact releases and tags, back up their metadata/bodies/assets, and
   confirm IDs still match the table before any PATCH.
2. If backend should be the repository's application landing release (it identifies
   the combined Compose artifact), update release 402587235 `backend-v0.21.0` with
   `make_latest: "true"`. Explicitly keep frontend 402587241, assets 402587247,
   legacy 402432199 and bootstrap 396396027 at `make_latest: "false"` if needed.
   Re-read `/releases/latest` and GraphQL `isLatest`; expected result is backend,
   not a guaranteed backend/frontend/assets list order. Future native publications
   can change the designation again; a persistent backend-only policy needs a
   separately approved supported post-release hook and exact-head tests.
3. Optionally clarify only names/bodies: label 402432199 and 396396027 "Legacy
   combined release" / "Legacy bootstrap snapshot" and link the three histories.
   Preserve existing rich notes and assets. This improves attribution, not sorting.

There is no justified release-metadata-only operation that guarantees arbitrary
chronological sidebar sorting. Keep tag commits, creation/publication dates and
release assets unchanged. Do not delete/recreate releases, republish historical
versions, or move tags to manipulate order. Use explicit component links from the
README when deterministic navigation is required.

## Reproduce

```sh
python3 scripts/verify-changelog-history.py
node --check scripts/verify-native-changelog.mjs
git diff --check
```

For the native updater smoke, supply unchanged `build/src/updaters/changelog.js`
and `default.js` from release-please 17.6.0 (no dependency installation is needed
for these two dependency-free files). The action lockfile pins that version.

```sh
node scripts/verify-native-changelog.mjs /absolute/path/changelog.js /scratch/native-next
python3 scripts/verify-changelog-history.py --native-directory /scratch/native-next
```

The native smoke performs three real updater prepends into scratch only, followed
by current-top-only enrichment and idempotence checks. It is not a full remote
Release Please dry-run and creates no releases/PRs/tags. CI runs the stdlib audit
and enrichment checks with full Git history; the optional native smoke is separate.
