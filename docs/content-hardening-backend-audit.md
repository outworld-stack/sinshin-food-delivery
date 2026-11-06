# Backend save revision and identity audit

This change builds on `41c0405` and the original article block architecture. The complete Arabic field inventory remains in [content-translation-lifecycle.md](content-translation-lifecycle.md). No production database, seed execution, deployment, environment changes, or remote push occurred.

## Required save contract

Existing content updates require the server-issued `sourceRevision`, including metadata-only and unchanged saves. `contentSourceRevision` hashes the canonical persisted row and field provenance, including the durable `writeRevision`. Admin GET responses compute the token from the original database row, never a localized or transformed DTO. Tokens are exactly `sha256:` followed by 64 lowercase hexadecimal characters. Missing, null, malformed, foreign, and stale tokens fail validation under the same transaction lock used for persistence.

`reconcileContentTranslation` advances `translationState.writeRevision` on every accepted save. Field source revisions still change only when the exact corresponding source/translation field changes: prices, availability, coordinates, styles and ordering do not invalidate text or trigger translator calls. Read-only article/product view and product sale counters are excluded from the save token; these trusted counter writes cannot alter editor content.

Updates submitting `ingredients`, `sizeNames`, `processes` or `sections` also require complete `translationIdentities`: ordered `{collectionPath,itemIds}` lists. They persist as `translationState.collections` in the existing JSONB sidecar. Existing collection IDs travel with their items; added items use new UUID-backed IDs. Removed IDs remain retired and cannot be reused. Legacy records expose deterministic identities for their unchanged persisted snapshot. No update infers item ownership from matching text or a changed array position. Existing product sizes and article subcategories require both their database ID and their own current revision; new children omit these persistent IDs/revisions.

Article and About blocks retain the existing source/provenance format. List IDs use `props.itemIds`; gallery image IDs use `images[].id`. The shared block identity validator runs against the locked previous source and previous Arabic provenance before normalization. It rejects changed legacy arrays without IDs, duplicate/cross-block IDs and retired IDs, while permitting unchanged legacy documents and structural-only changes. Exact coordinates, URLs, block order, type, styles and source structure remain Persian-owned.

The HTTP Arabic block schema preserves nested `itemId` source proofs, orphaned manual drafts and retired item IDs. Existing 256 KB content and 2 MB provenance limits count the original content/proof shape through `articleBlocksContentForLimit`; only the newly introduced identity/recovery bookkeeping is excluded. The existing 8 MB raw request limit remains unchanged. Regression fixtures use all 200 blocks and 6,000 nested fields with 64-character block IDs: legal legacy provenance fits below 2 MB, while its additional bound identities exceed 2 MB. HTTP create/save/reload and preview remain supported without removing any source text or Arabic proof.

## Admin mutation paths

| Content | Source and Arabic save paths | Guard and identity persistence |
| --- | --- | --- |
| Main category | `MenuService.createMainCategory`, `updateMainCategory`; POST `/admin/menu/mains`, PATCH `/admin/menu/mains/:id` | Creates remain revision-free; updates lock the main row and require its proof. |
| Product category and size templates | `MenuService.createCategory`, `updateCategory`; POST/PATCH `/admin/menu/categories` | Locked parent proof; submitted templates require complete stable template identities. |
| Product and ingredients | `MenuService.createProduct`, `updateProduct`; POST/PATCH `/admin/menu/products` | Locked product proof, ingredient identity list and transactional junction/size writes. |
| Product size name | Product create/update and `insertSizes` in `menu.service.ts` | Existing children matched only by database ID; each child locks and verifies its own proof. Temporary rename placeholders exist only inside the locked parent transaction, then the final exact-source reconciliation persists atomically. |
| Packaging title | `PackagingService.add`, `update`; POST/PATCH `/admin/menu/packaging-items` | Existing item proof and row lock; price/activity/order changes advance the save token without invalidating title text. |
| Article scalar text, processes and blocks | `ArticleService.create`, `update`; POST/PATCH `/admin/articles` | Parent proof checked under row lock; stable process and block item identities validated before source normalization/reconciliation. |
| Article category/subcategory name | `ArticleService.createCategory`, `updateCategory`; POST/PATCH `/admin/articles/categories` | Taxonomy advisory lock plus parent/child row locks. Existing child IDs/proofs mandatory; duplicate IDs, duplicate normalized update names and blank persisted-ID names reject transactionally; name-only legacy update arrays rejected. Creation keeps its existing name deduplication. |
| About scalars, blocks and address | PATCH `/admin/about` in `about.routes.ts` | Singleton advisory lock plus row lock; existing row requires proof. First creation remains revision-free. Block merge/provenance and location coordinates remain independently preserved. |
| Gallery alt | `GalleryService.add`, `update`; POST/PATCH `/admin/gallery` | Existing row proof and row lock. Missing records fail explicitly; URL/span/activity changes preserve alt validity. |
| Terms titles/items | `TermsService.update`; POST `/admin/terms` | Terms advisory lock plus latest version row lock. First version revision-free; later saves require latest row proof and full section/item identities. Accepted historical versions remain immutable. |
| Temporary closure reason | `SettingsService.setTemporaryCloseContent`, via `Admin2Service.setTemporaryClose` and POST `/admin/settings/temporary-close` | Closure advisory lock and source-setting row lock. Existing source setting requires proof; initial creation remains revision-free. Generic `SettingsService.set` rejects both bilingual reason keys, preventing an alternate write bypass. Existing closure/payment policy is unchanged. |

Route schemas bound revision and identity payloads. Service-level checks remain authoritative for direct/internal callers. Arabic clears require current save/field proofs and retain manual empty tombstones, preventing a running worker from refilling explicitly cleared fields. Unchanged Arabic values in an old form are never new review proof.

## Alternate and multirow admin writes

| Path | Required proof and lock |
| --- | --- |
| Main visibility toggle; main/category purchase switch | `sourceRevision`; locked target row; every successful operation, including a no-op, advances its write revision. |
| Main default selection/reorder | `sourceRevisions: Record<id,string>`; deterministic row locking; proofs checked for every changed row. No partial default/order changes can persist when a neighbor/current default proof is missing or stale. |
| Product status toggle/availability switch | `sourceRevision`; locked product row; updated revision persists with the metadata and invalidates caches after commit. |
| Article status toggle | POST `/admin/articles/:id/toggle` with `sourceRevision`; locked article and durable revision advancement. Admin list tokens come from a coherent full original-row query. |
| Gallery reorder | POST `/admin/gallery/:id/reorder` with `direction` and `sourceRevisions`; locks sorted rows, proves the selected image and swap neighbor, advances both revisions atomically. |

Deletes (`remove`, `deleteCategory`, packaging removal) retain their existing explicit deletion semantics and authorization. They submit no replacement source/Arabic document and cannot restore stale content. Foreign keys retain their existing cascade/reference clearing rules. Related caches are invalidated by existing mutation paths.

## Trusted internal writes and safe exceptions

`domain/translation/content-translation.worker.ts` rechecks the exact eligible field identity/source/revision before requests and again under the entity row lock before persistence. Only the selected Persian string reaches the translator. Collection results follow stable IDs to the current field path. Manual and completed values are ineligible. Queue attempt ownership is checked under the job lock; reaped attempts and superseded terms versions cannot write or request later siblings. Block results additionally check stable nested item identity. `content-translation.store.ts` persists explicitly listed Arabic columns and provenance only; source text, prices, images and coordinates cannot be overwritten by worker output. Cache invalidation follows successful persistence.

Both successful worker results and persisted failure status advance the durable write revision. Failure metadata is committed before cache invalidation so admin reloads can observe the exact failed field; read-only preview failures do not invalidate caches. Failed block writes preserve the existing provenance object, including orphaned drafts and deletion tombstones.

`translation.service.ts` performs queue claim/heartbeat/retry/reap/successor writes on job metadata, rather than source content. Entity deduplication prevents concurrent work for the same entity, and a completed/running job does not suppress a new changed-source successor. Translation previews are read-only and validate their selected field/source/revision independently of whole-form tokens.

`drizzle/seed.ts` and `drizzle/seed.deploy.ts` were inspected without being executed or changed here. Their existing Arabic backfills use atomic SQL compare-and-set conditions: exact expected Persian source, missing Arabic value and null field provenance. About/categories compare each scalar/template independently; product description/ingredients compare their own exact sources; sizes retain product ownership/name checks; article backfill excludes block articles and compares excerpt/content/process sources independently. They cannot overwrite populated or provenance-managed translations, and cannot change Persian source content. Initial seed inserts remain the revision-free creation exception. These trusted legacy-only initialization writes are not interactive admin saves.

Article view buffering, product views/sales, category/product junction reference changes and statistics jobs were audited separately. They submit no translated source text; the existing business/statistics behavior remains unchanged. Searches found no separate database content import service or unguarded runtime source writer outside the listed paths. Static Arabic UI dictionaries remain separate from this lifecycle.

## Executed regression coverage

`scripts/test-content-save-hardening.ts` calls actual services/routes directly and proves all twelve content families reject omitted/null/empty/malformed/foreign proofs without writes. It proves same-revision/no-op saves have one winner, tokens advance, stale token reuse fails, mutable arrays require identities, and article/gallery metadata actions preserve manual Arabic.

The existing product, entity, worker, About, article, block, menu, purchase, product ordering and temporary-closure regressions use fresh raw-row proof fixtures. Reorder/insert/delete fixtures explicitly carry stable identities rather than relying on server text matching. Worker mocks prove one changed field sends one string, completed/manual siblings are excluded, running results cannot restore changed sources and latest terms versions stay independent. The pre-existing migration suite verifies all twelve legacy Arabic columns survive the additive JSONB migration unchanged. Detailed final command results are recorded in the overall hardening validation report.

The first Terms save accepts client-generated stable section/item identities and source-bound manual proofs without requiring a revision for a nonexistent record. The About HTTP regression also repairs legacy invalid coordinates using an admin token computed from the raw persisted row before sanitizing its visible location; existing blocks and manual Arabic survive unchanged.

The final independent diff review reproduced a subcategory data-loss path: changing one child name to its untouched sibling's name caused name-keyed normalization to discard the sibling ID and later delete its manual Arabic and article reference. Updates now reject ambiguous normalized names and blank persisted-ID names. Database regressions test both duplicate submission orders and verify full rollback of parent/children/translation provenance, preserved article links and no cache invalidation, while the original creation deduplication test still passes.

All commands below were actually executed from `apps/api` and returned exit code 0. Tests use disposable localhost PostgreSQL databases and deterministic translation mocks.

| Command | Observed result |
| --- | --- |
| `rtk proxy bun run db:test:content-hardening` | 39 groups |
| `rtk proxy bun run db:test:content-products` | 13 groups |
| `rtk proxy bun run db:test:content-entities` | 13 groups |
| `rtk proxy bun run db:test:content-worker` | 42 groups |
| `rtk proxy bun run db:test:content-migration` | 24 groups |
| `rtk proxy bun run db:test:about` | 14 groups, including maximum document HTTP saves |
| `rtk proxy bun run db:test:articles` | 53 groups, including maximum legacy HTTP create/review saves |
| `rtk proxy bun run db:test:block-translations` | 49 groups, including completed maximum preview and exactly one eligible-field request |
| `rtk proxy bun run db:test:blocks` | 82 normalizer checks, all block translation regressions, 9 stable block-item groups |
| `rtk proxy bun scripts/test-content-block-item-worker.ts` | 5 database block-item worker groups |
| `rtk proxy bun run test:content-shared` | 56 lifecycle groups, compact source revision suite, 20 identity/revision groups |
| `rtk proxy bun run db:test:menu` | 9 groups |
| `rtk proxy bun run db:test:purchase` | 7 groups |
| `rtk proxy bun run db:test:products-order` | 9 groups |
| `rtk proxy bun run test:temporary-close` | Passed |
| `rtk proxy bun run typecheck` | Passed |
| `rtk proxy bun build src/index.ts --target=bun --outdir=../../.tmp/content-hardening-api-build --minify` | 670 modules, 1.38 MB |

`rtk proxy bun .tmp/content-hardening-backend-lint.ts` was executed from the repository root. It invoked the project's installed Biome from `apps/web`, applied the same configuration to the exact changed API/shared files and their `HEAD` copies, and reported a comparison exit code of 0 with no increased per-file diagnostic groups. The inclusive lint itself is not clean: current 39 files have 1 existing error, 297 warnings and 4 informational diagnostics; the 34 corresponding baseline files have 1 error, 301 warnings and 4 informational diagnostics. All five new files are clean. The unchanged error is `lint/suspicious/noThenProperty` in `scripts/test-temporary-close.ts`'s test query mock. Remaining warnings mainly concern existing test non-null assertions; seven concern the existing menu implementation. Temporary lint scripts/baselines/reports and build artifacts were removed after verification; observed results are retained here and in the final coordinating report. `rtk proxy git diff --check` also returned exit code 0.

## Existing cache concurrency limitations

Two existing read-cache races are outside the revision/identity hardening scope. `PackagingService.adminList` can finish an old in-flight read after invalidation and refill its 30-second local list cache. `VersionedCache.version` can finish an old Redis version lookup after the same instance invalidates, repopulating its five-second version cache with the earlier value. An admin reload can consequently receive a temporarily obsolete token. Neither race bypasses save protection: locked raw database revision comparison rejects that token and cannot restore stale Persian/Arabic values or attach translations to different items. The generic cache implementation and unrelated business behavior were not changed; these bounded freshness limitations remain documented rather than silently redesigned.
