# Content translation hardening: final audit and validation

Local branch: `fix/content-translation-revisions-and-identities`, based on `41c0405`. This change preserves the existing translation lifecycle and the article architecture introduced by `2723c083e1151b09bebf03026bcfe4cbb1d1326f`. It hardens saved revisions and ordered collection identity. It adds no migration or alternative translation store.

## Separate final diff audit

The implementation was followed by a separate review of the complete changed-file set, including newly added tests. The backend reviewer independently traced routes, service calls, raw database writes, queue persistence, legacy initialization and public localization. The frontend reviewer traced clients, forms, alternate actions, draft resets and collection operations. The coordinating review repeated searches for revision helpers, optional proofs, untranslated source writers, index matching, text matching and provenance replacement, then inspected the identified paths.

Detailed evidence is retained in [the backend inventory](content-hardening-backend-audit.md), [independent backend review](content-hardening-final-backend-review.md), [frontend inventory](content-hardening-frontend-audit.md) and [identity design](content-hardening-identities.md). The existing field inventory remains in [content-translation-lifecycle.md](content-translation-lifecycle.md).

## Exhaustive update contract

Every existing-record update below requires a current server-issued `sha256:<64 lowercase hexadecimal characters>` proof. It is compared with the latest persisted source/provenance while holding the transaction lock used for the write. Missing, null, malformed, foreign and outdated proofs fail with the existing validation response (`422`, `VALIDATION_ERROR`); route schemas also reject malformed payloads. `writeRevision` advances on successful metadata-only and no-op saves as well as content/translation writes, so two requests using one revision cannot both silently succeed.

| Update route | Authoritative service/handler | Mandatory proof and atomic protection |
| --- | --- | --- |
| PATCH `/admin/menu/mains/:id` | `MenuService.updateMainCategory` | Target `sourceRevision`; transaction and row lock |
| POST `/admin/menu/mains/:id/toggle` | `toggleMainCategory` | Target proof; transaction and row lock |
| POST `/admin/menu/mains/:id/default` | `setDefaultMainCategory` | `sourceRevisions` for target and every changed previous default; deterministic row locks |
| POST `/admin/menu/mains/:id/reorder` | `reorderMainCategory` | Target and swap-neighbor proofs; deterministic row locks; boundary no-op also consumes its revision |
| POST `/admin/menu/mains/:id/purchase` | `setMainPurchase` | Target proof; transaction and row lock |
| PATCH `/admin/menu/categories/:id` | `updateCategory` | Category proof; transaction and row lock; template identity projection validated |
| POST `/admin/menu/categories/:id/purchase` | `setCategoryPurchase` | Category proof; transaction and row lock |
| PATCH `/admin/menu/products/:id` | `updateProduct` | Product proof; transaction and row lock; ingredient identity projection validated |
| Existing sizes inside product PATCH | `updateProduct` size reconciliation | Own database ID and own `sourceRevision` for every existing submitted size; child row locks inside parent transaction |
| POST `/admin/menu/products/:id/toggle` | `toggleProductStatus` | Product proof; transaction and row lock |
| POST `/admin/menu/products/:id/availability` | `setProductAvailability` | Product proof; transaction and row lock |
| PATCH `/admin/menu/packaging-items/:id` | `PackagingService.update` | Item proof; transaction and row lock |
| PATCH `/admin/articles/:id` | `ArticleService.update` | Article proof; transaction and row lock; process/block item identities validated before normalization |
| POST `/admin/articles/:id/toggle` | `ArticleService.toggle` | Article proof; transaction and row lock |
| PATCH `/admin/articles/categories/:id` | `ArticleService.updateCategory` | Category proof; taxonomy advisory lock and row locks |
| Existing subcategories inside category PATCH | `updateCategory` child reconciliation | Own persistent ID and own proof; duplicate IDs rejected; child row locks |
| PATCH `/admin/about` | `about.routes.ts` update handler | Proof required whenever a row exists; singleton advisory lock and row lock |
| POST `/admin/terms` | `TermsService.update` | Latest saved version proof; singleton advisory lock and row lock; historical versions immutable |
| PATCH `/admin/gallery/:id` | `GalleryService.update` | Image proof; transaction and row lock |
| POST `/admin/gallery/:id/reorder` | `GalleryService.reorder` | Target and swap-neighbor proof map; row locks; boundary no-op consumes revision |
| POST `/admin/settings/temporary-close` | `Admin2Service.setTemporaryClose` → `SettingsService.setTemporaryCloseContent` | Proof whenever the source setting exists; singleton advisory lock and source row lock |

Optional tokens remaining in public/admin DTO types do not authorize writes: public responses need no editor proof, whereas update services and clients validate them. Optional singleton method/schema parameters support first creation only; the existence decision occurs under the same advisory lock as persistence. A concurrent first-create request therefore cannot replace an existing record without its current proof. Shared helpers accept unknown/omitted arguments so runtime callers can be rejected, and never treat `undefined` as a successful match.

Admin API clients send pinned server snapshots, including nested child and multirow proofs. They never hash edited/display DTOs or accept an incidental refetch as a reviewed draft. Failed saves retain source and manual Arabic drafts. Terms has an explicit first-create client chosen only after a confirmed empty version-0 load. Gallery edit mode closes only after save success, and the main-category form displays rejected-save errors.

The separate audit reproduced stale positional editor callbacks before fixing them. Source/manual edits, move/delete/duplicate callbacks, size metadata/upload completions and block structural controls now resolve captured stable IDs against the latest draft. The existing block primitives and business values remain unchanged. A delayed callback for a deleted item cannot restore it, modify a replacement item or send that replacement's text to the translator. Nested Arabic block keys also follow item IDs so reorder preserves the logical editor row.

## Internal writes without a whole-form sourceRevision

| Audited path | Why it is safe or outside the update contract |
| --- | --- |
| `ContentTranslationWorker.run`, field success/failure persistence and `deriveArticleContent` | Re-read exact identity/source/field revision and eligibility under row locks; verify queue attempt ownership; write only allowed Arabic/provenance columns through `writeContentRow`; every committed write advances common revision and invalidates after commit |
| `TranslationService` queue claim, heartbeat, completion, retry, reap and successor operations | Update job metadata, not source content; attempt ownership fences late workers |
| Translation previews | Read-only; selected stored field/source/revision checked before requests and again afterward; no source/Arabic persistence |
| `insertSizes`, record create methods and first About/Terms/closure insertion | Create genuinely new records; no previous editor snapshot is overwritten |
| Product-size temporary rename placeholders | Inside the locked parent/child transaction; final original-row reconciliation commits atomically or all placeholders roll back |
| Article view buffer and `product-stats.service.ts` view/sale counter writes | Only counters expressly excluded from editor proofs; cannot change translated text or identities |
| Explicit deletes and junction/reference cleanup | Existing deletion semantics; do not submit a replacement source/Arabic draft or transfer removed-item translations |
| Generic `SettingsService.set`, print settings and unrelated settings routes | Separate non-translatable settings; both bilingual closure-reason keys are explicitly rejected by the generic setter |
| `drizzle/seed.ts`, independent `drizzle/seed.deploy.ts` | Inspected, unchanged and not executed. Existing legacy backfills use atomic exact-source/missing-Arabic/null-provenance conditions and preserve populated Arabic; insertion paths initialize new records |
| DB backfills and other searched upserts | Unrelated device, authentication, notification, payment or print metadata; no translated source writer found |

No unguarded runtime source writer or additional content import path was found. Static Arabic interface dictionaries remain separate and unchanged.

## Exhaustive ordered-item identity audit

| Collection | Persistent identity and mutation behavior |
| --- | --- |
| Product ingredients | `translationState.collections` IDs under `ingredients`; frontend carries IDs with source/Arabic rows; new rows get UUIDs; deletion retires IDs |
| Category size-name templates | Same sidecar under `sizeNames`; edit retains ID; move carries ID and Arabic row; backend requires complete projection |
| Terms sections and individual clauses | Stable section ID and child IDs in that parent's `:items:` namespace; reordered parent rebases child paths without changing ownership; immutable new document versions retain IDs |
| Article processes and steps | Same sidecar/namespaces; simultaneous title/step edits and moves reconcile by ID; removed fields become recoverable orphan drafts |
| Product sizes | Existing database UUID, never size name or array position; own revision on update; newly added size gets a fresh database UUID |
| Gallery image records | Database image UUID; list order changes `sortOrder` only; individual alt validity remains source-bound |
| Article categories/subcategories | Database category/subcategory UUID; existing children require ID/proof; name-only legacy replacement updates rejected |
| Article and About block documents | Existing block ID/type; list children use `props.itemIds`, gallery children use `images[].id`, proofs carry optional `itemId`; changed text invalidates only that child; Persian structure/coordinates remain authoritative |

Nested identities persist in the existing JSONB sidecars/document. `translationIdentities` is a transient validated save projection, never an alternative database state. Duplicate, foreign-parent and retired IDs fail validation. New entries cannot inherit a deleted field's translation. Changed legacy collections without identity proof are rejected by update paths; conservative direct reconciliation creates new identities and preserves unmatched Arabic in the existing bounded review archive.

The audit also reproduced a pre-existing subcategory normalizer that deduplicated updated entries by text before ID reconciliation, silently deleting an unchanged manual sibling and clearing linked article references. Updates now reject duplicate normalized names and blank names for persisted child IDs before any deletion can commit. Creation keeps its existing deduplication behavior. The two new database hardening groups prove complete parent/child/article rollback in both submitted ID orders and no cache invalidation on rejection.

Remaining index usage was classified explicitly:

- `collectionTranslationIdentities` and `getArticleBlockItemId` bootstrap deterministic identities only from an unchanged persisted legacy snapshot. Exact saved source proof is required where provenance exists. Mutation services require explicit IDs and never use these positions to infer a changed item's ownership.
- `collectionPrefix`, `collectionPaths`, `definitions`, `fieldPath`/`arabicPath`, `articleBlockTextPathForIdentity`, and frontend projection helpers use indexes to address the current ordered document. Stable IDs determine logical matching; parent moves rebase paths with the ID projection.
- Block normalization filters text/images and IDs as one row, so filtering cannot shift one item's ID onto another item's text.
- Parallel Arabic array accesses in product/category/process forms and public DTOs address reconciled current slots; move/delete handlers carry the corresponding IDs and Arabic rows together.
- JSX key fallbacks and list/reorder indexes are presentation/addressing only. New source rows have IDs before editing/translation, and these fallback keys are never submitted as field proof identities.
- Worker response indexing maps a deterministic request batch to its response, not to a mutable database position. Source/ID/revision checks occur before saving. Reordered in-flight nested results locate the same ID at its latest path.

The real component regressions in `test-content-collection-editors.tsx` and `test-articles-admin.tsx` cover repeated old moves/deletes, multiple old text callbacks after reorder, parent/child moves, delayed size metadata/uploads, gallery removal plus old alt editing, and block drag/drop after a newer source edit. `test-content-block-translations-client.tsx` proves delayed Arabic edit/translate callbacks follow the selected nested ID and ignore deleted IDs. `test-content-save-conflicts.tsx` proves gallery conflicts keep the editor/draft visible, duplicate saves stop, success closes the editor and unmounted callbacks do not update state; main-category conflicts display the error and keep the pinned draft.

## Executed validation

The following commands completed with exit 0. Database tests used disposable loopback PostgreSQL databases; deterministic mocks forbade external translator requests.

| From `apps/api` (prefix `rtk proxy`) | Observed result |
| --- | --- |
| `bun run test:content-shared` | 56 lifecycle groups, compact SHA-256 revision suite, 20 identity/revision groups |
| `bun run db:test:content-hardening` | 39 groups; all 12 families, missing/null/malformed/stale proofs, same-token races, nested/multirow guards, revision-free first creation and ambiguous child-name rollback |
| `bun run db:test:content-products` | 13 groups |
| `bun run db:test:content-entities` | 13 groups |
| `bun run db:test:content-worker` | 42 lifecycle groups plus 5 nested-ID worker groups; late replies, reorder, exact changed-only requests, manual drafts, failure writes |
| `bun run db:test:articles` | 53 groups including real HTTP preservation of proofs/tombstones and maximum legacy document compatibility |
| `bun run db:test:about` | 14 groups including raw legacy-location revision and maximum document HTTP saves |
| `bun run db:test:blocks` | 82 normalizer checks, existing all-block translation suite, 9 nested-ID groups |
| `bun run db:test:block-translations` | 49 integration checks including a legal 6,000-field preview that skips completed fields and sends exactly one missing text |
| `bun run db:test:content-migration` | 24 legacy-data checks |
| `bun run db:test:migrations` | 82 general migration checks |
| `bun run db:test:menu` / `db:test:purchase` / `db:test:products-order` | 9 / 7 / 9 groups |
| `bun run test:temporary-close` | Passed |
| `bun run typecheck` and shared TypeScript check | Passed |
| API production bundle using existing Bun build workflow | Passed: 670 modules, 1.38 MB minified |

Frontend final verification and lint comparison are recorded in [the frontend audit](content-hardening-frontend-audit.md). From `apps/web`, `rtk proxy bun run test:content-translations`, `test:articles`, `test:about`, `test:products`, `test:temporary-close`, `test:seo`, `typecheck` and `build` all exited 0 after the final editor/conflict fixes. The production build transformed 3,501 client, 543 SSR and 3,302 Nitro modules. The articles suite and inclusive lint comparison were rerun after the final test-only deferred drag/drop regression.

The existing 256 KB block-content and 2 MB provenance limits remain based on their original content model: new identity/recovery bookkeeping is excluded by one shared projection. The application's raw 8 MB request cap is unchanged. Maximum-model HTTP and service/preview tests prove this compatibility without weakening original text limits.

Inclusive API/shared lint compared 39 changed/new files with their baseline: current 1 error, 297 warnings and 4 infos; baseline 1 error, 301 warnings and 4 infos. Both raw lint commands exit 1; the comparison exits 0 with no increased file/rule/severity groups. The existing error is `test-temporary-close.ts`'s fake-query thenable (`noThenProperty`). All five new backend tests/helpers are clean; scoped production/shared lint retains seven existing menu warnings. Frontend baseline diagnostics and the existing large-chunk build warning are detailed in its audit; whole-repository lint is not claimed clean.

Inclusive frontend lint compared 38 changed/new files with 35 corresponding baseline files: current 39 errors and 85 warnings; baseline 39 errors and 88 warnings. Raw lint exits 1 on both; comparison exits 0 with no increased file/rule/severity groups. Latest scoped frontend lint exits 0 with no diagnostics. The existing Vite warning for chunks larger than 500 KB remains; the production build succeeds.

Database mutation/concurrency regression coverage is service-level across all 12 families. Article/About save and translation preview suites additionally exercise actual HTTP handling/schema serialization. Other listed route guards were traced and their authoritative services executed; there is no separate browser automation test for every route. Frontend regression suites execute real component handlers with mocked network/translator boundaries. No production or paid translation endpoint was tested.

## Scope limitations

Two unchanged cache races were reproduced and documented: a Packaging in-flight read can repopulate its 30-second cache after invalidation, and an old `VersionedCache` version lookup can repopulate its local version cache. They can return an old display/editor snapshot, but mandatory comparison against the locked current database row rejects its stale proof and cannot restore stale translations. The existing five-second cross-replica cache-version TTL also remains. These pre-existing cache freshness issues are outside the user's two-item hardening scope; no shared cache refactor was made.

No migration, seed, production data/configuration change, live paid translation call, deployment, Git commit or remote push occurred. Task-generated temporary builds, lint baselines/logs and reproductions were removed after verification; the pre-existing `.tmp/article-field-api-build` directory was preserved.

The separate final revision and array-identity audits found no unresolved update-proof bypass or unsafe positional translation/draft matching. Scope limitations and the distinction between service/HTTP/component coverage are explicit above. `git diff --check` passes.

## Exact changed files

The 84 changed/new files, relative to the repository root:

```text
apps/api/package.json
apps/api/scripts/content-save-fixtures.ts
apps/api/scripts/test-about.ts
apps/api/scripts/test-admin-products-order.ts
apps/api/scripts/test-article-block-translations.ts
apps/api/scripts/test-articles.ts
apps/api/scripts/test-block-item-identities.ts
apps/api/scripts/test-block-translations.ts
apps/api/scripts/test-category-purchase.ts
apps/api/scripts/test-content-block-item-worker.ts
apps/api/scripts/test-content-entities.ts
apps/api/scripts/test-content-identities.ts
apps/api/scripts/test-content-products.ts
apps/api/scripts/test-content-save-hardening.ts
apps/api/scripts/test-content-shared.ts
apps/api/scripts/test-content-source-revision.ts
apps/api/scripts/test-content-worker.ts
apps/api/scripts/test-menu-safety.ts
apps/api/scripts/test-temporary-close.ts
apps/api/src/domain/article/article.service.ts
apps/api/src/domain/article/blocks-normalize.ts
apps/api/src/domain/gallery/gallery.service.ts
apps/api/src/domain/menu/menu.service.ts
apps/api/src/domain/menu/packaging.service.ts
apps/api/src/domain/settings/settings.service.ts
apps/api/src/domain/terms/terms.service.ts
apps/api/src/domain/translation/content-translation.worker.ts
apps/api/src/domain/translation/translation.service.ts
apps/api/src/http/routes/about.routes.ts
apps/api/src/http/routes/admin-menu.routes.ts
apps/api/src/http/routes/admin-settings.routes.ts
apps/api/src/http/routes/articles.routes.ts
apps/api/src/http/routes/content-translation.schemas.ts
apps/api/src/http/routes/gallery.routes.ts
apps/api/src/http/routes/terms.routes.ts
apps/web/package.json
apps/web/scripts/test-about-admin.tsx
apps/web/scripts/test-about-client.tsx
apps/web/scripts/test-articles-admin.tsx
apps/web/scripts/test-articles-api-client.ts
apps/web/scripts/test-content-block-translations-client.tsx
apps/web/scripts/test-content-collection-editors.tsx
apps/web/scripts/test-content-save-conflicts.tsx
apps/web/scripts/test-content-translation-api-client.ts
apps/web/scripts/test-content-translations-client.tsx
apps/web/scripts/test-products-client.tsx
apps/web/scripts/test-temporary-close-admin.tsx
apps/web/src/components/admin/ArticleForm.tsx
apps/web/src/components/admin/ProductForm.tsx
apps/web/src/components/admin/articles/ArticleCategoryManager.tsx
apps/web/src/components/admin/articles/builder/ArticlePageBuilder.tsx
apps/web/src/components/admin/articles/builder/blockModel.ts
apps/web/src/components/admin/articles/builder/useArabicBlockTranslations.ts
apps/web/src/components/admin/products/AdminProductCard.tsx
apps/web/src/components/admin/products/CategoryManager.tsx
apps/web/src/components/admin/products/CategoryPurchaseManager.tsx
apps/web/src/components/admin/products/MainCategoryManager.tsx
apps/web/src/components/admin/products/PackagingItemsManager.tsx
apps/web/src/components/admin/settings/GalleryImageRow.tsx
apps/web/src/components/admin/settings/GalleryManager.tsx
apps/web/src/components/admin/settings/TemporaryCloseCard.tsx
apps/web/src/components/admin/settings/TermsEditor.tsx
apps/web/src/hooks/admin/useAdminProductsPage.ts
apps/web/src/hooks/admin/useContentTranslationDraft.ts
apps/web/src/hooks/admin/useSiteContentSettings.ts
apps/web/src/routes/admin/articles/index.tsx
apps/web/src/server/about.ts
apps/web/src/server/admin.ts
apps/web/src/server/articles.ts
apps/web/src/server/gallery.ts
apps/web/src/server/products.ts
apps/web/src/server/terms.ts
apps/web/src/types/forms.ts
apps/web/src/utils/contentTranslationDraft.ts
docs/content-hardening-backend-audit.md
docs/content-hardening-final-backend-review.md
docs/content-hardening-frontend-audit.md
docs/content-hardening-identities.md
docs/content-hardening-validation.md
docs/content-translation-lifecycle.md
packages/shared/src/block-translations.ts
packages/shared/src/blocks.ts
packages/shared/src/content-translations.ts
packages/shared/src/contracts.ts
```
