# Frontend content save and identity audit

This change builds on `41c0405` and the existing translation sidecars. Static interface dictionaries and public locale routing are unchanged; the article block document format remains compatible.

## Saved revisions

Admin DTOs supply `sourceRevision` calculated from the persisted row. `useContentTranslationDraft` captures that exact token with its initial snapshot and changes it only when the editor deliberately resets to a saved server snapshot. It does not calculate revisions from display DTOs, edited source text, translated suggestions, or a query refresh received while a draft is active.

`requireContentSourceRevision` stops an update before its network request when the saved token is unavailable. Its message explains that the admin must reload/review and that the draft is retained. Existing API conflict errors continue through the current mutation/form error controls. Failed saves do not clear Arabic drafts or source text. Creates need no existing-record token. Deletes do not submit old source content and retain the existing delete contracts.

Terms first creation uses the separate `createTerms` client only after the editor has loaded an empty version-0 admin snapshot without a persisted ID. A missing or failed load does not authorize creation. Existing Terms always use token-guarded `updateTerms`; the server's locked current-record check rejects a concurrent first-create attempt if another version was saved in the meantime. Such failures preserve both source and Arabic drafts.

| Content/path | Snapshot and update implementation |
| --- | --- |
| Product fields and ingredients | `ProductForm`, `useContentTranslationDraft`, `server/products.ts` product update |
| Persisted product size | Raw size `sourceRevision`, `ProductSizeArabicField`; each existing size token is checked before product update; draft sizes still omit persisted IDs |
| Main category name | `MainCategoryForm` saved main DTO and `updateMainCategory` |
| Product category/template names | `CategoryManager` saved category DTO and `updateCategory` |
| Article scalars/processes/blocks | `ArticleForm` saved article DTO and `updateArticle`; existing block source proof/revision remains independent |
| Article category and subcategory | Category hook snapshot; each subcategory token is captured when its dialog opens and retained with its stable ID, rather than recalculated from refreshed source |
| About scalar/address/blocks | `AboutContentForm` saved About DTO; confirmed saved refetch explicitly resets the hook |
| Terms sections/items | `TermsEditor` keeps the original terms record snapshot while dirty, including when another admin creates a newer terms version |
| Gallery alt/image metadata | `GalleryImageRow` saved image DTO and guarded `updateGalleryImage`; active toggle carries the raw image token |
| Packaging title/price/active state | Title hook snapshot and raw item token for price/active changes; guarded `updatePackagingItem` |
| Temporary close reason | Raw status DTO token is retained when mapping the reason fields for `TemporaryCloseCard`; guarded `setTemporaryClose` |

Alternate metadata actions also send revisions. Product status/availability, article status, main category visibility, and main/category purchase state use the selected raw admin DTO token. Main default/reorder and gallery reorder send `sourceRevisions` maps from the current raw admin collection so the server can validate every affected row. Their existing cache invalidation and optimistic rollback behavior remain in place.

Client modules audited: `server/products.ts`, `server/articles.ts`, `server/about.ts`, `server/gallery.ts`, `server/terms.ts`, and the temporary close operation in `server/admin.ts`. Call sites audited include both article/product edit routes, `useAdminProductsPage`, `AdminProductCard`, main/category/purchase/packaging managers, `useSiteContentSettings`, Gallery manager/row, About form, Terms editor, and temporary close dialog.

The final conflict audit added awaited Gallery update plumbing through `useSiteContentSettings`, `GalleryManager`, and `GalleryImageRow`. A failed update keeps its editor, Persian text, manual Arabic draft, and captured token; duplicate saves and updates after unmount are ignored. The main-category modal now displays server save failures without closing or clearing its draft.

## Stable nested source identities

The persisted format is `translationState.collections`; the save projection is `translationIdentities`. Source arrays and DTO shapes remain compatible with existing records. Shared bootstrap helpers read legacy records; editors retain those identities alongside their source entries after hydration.

| Collection | Editor behavior |
| --- | --- |
| Product ingredients | Exact source edit retains the ID; add creates a UUID; remove/move updates the ID and Arabic arrays together |
| Category size templates | Exact source edit retains the ID; add/remove/move explicitly updates the projection; limits match the API (12 templates, 40 characters) |
| Article processes and steps | Titles and steps have individual source controls; title/step edit retains the ID; append/delete/move retains parent ownership and moves Arabic slots with the source |
| Terms sections and items | Individual source textareas replace ambiguous multiline remapping; each row holds its ID, Persian source, and Arabic draft; edits preserve IDs and moves carry the complete row |
| Article subcategories | Persisted subcategory IDs, local draft keys, and captured tokens remain aligned; deletion uses the selected index so equal edited names cannot delete another row |
| Product sizes/gallery images/blocks | Existing persisted IDs remain unchanged; unsaved sizes retain their separate local `draftId`; nested block list/gallery identities use the existing block sidecar primitives |

Collection IDs are never inferred from edited text or guessed after a reorder. New IDs are created only when adding an entry. `contentTranslationDraft.ts` contains the shared frontend projection operations. The hook reconciles explicit projections before producing field bindings and edit proofs. Existing manually reviewed siblings remain preserved when an edited source entry moves.

Real component regressions reproduce a reorder and an old text/Arabic/move/delete callback before another render. Ingredient, template, process/step, and Terms section/item handlers now resolve their captured stable IDs against current state. A late saved-size name, price, discount-window, or upload callback cannot restore a deleted size or replace the surviving row's current source/manual translation. Existing values and conversion rules remain unchanged; each operation merges only its intended fields by saved size ID or draft ID. Arabic size callbacks patch only Arabic fields by size ID. Article subcategory edits, deletion, and queued addition resolve retained keys and preserve every remaining saved ID and token.

Independent pre-existing behavior outside this focused acceptance fix remains unchanged: Gallery creation clears its form after starting its create request, and packaging price blur clears the price draft before request settlement. Neither path carries an older Persian/Arabic translation document into an update. Product-size price/window/image controls keep their existing business behavior; their state patches now merge by stable size identity to preserve current text and Arabic drafts.

## Executed validation

All commands below run from `apps/web`, with the required `rtk proxy` prefix:

- `bun run typecheck`: exit 0 after backend signature updates.
- `bun run test:content-translations`: exit 0, including the new real component collection editor regressions, guarded first Terms creation/conflict regressions, and 21 missing-proof mutation cases.
- `bun run test:products`: exit 0.
- `bun run test:articles`: exit 0.
- `bun run test:about`: exit 0.
- `bun run test:temporary-close`: exit 0.
- `bun run test:seo`: exit 0.
- `bun run build`: exit 0; 3,501 client modules, 543 SSR modules, and 3,302 Nitro modules transformed. The build retains Vite's warning about chunks larger than 500 kB after minification; no build errors occurred.
- Scoped Biome lint of 11 changed client/hook/utility/Terms files: exit 0, zero diagnostics. Inclusive lint of the three content client/editor regression scripts: exit 0, zero diagnostics.
- Latest scoped Biome lint of the three content save/client/collection scripts plus Terms editor and site-content hook: exit 0, zero diagnostics.

The content, article, About, product, temporary close, and SEO suites, TypeScript check, production build, and inclusive lint comparison were rerun after the final block callbacks, simultaneous collection edit/reorder fixes, first Terms creation, and Gallery/main-category conflict handling. All test, TypeScript, and build commands exited 0. The production build log is `.tmp/content-frontend-build.txt`.

After the final test-only deferred drag/drop regression was added, `bun run test:articles` and the inclusive lint comparison were rerun and exited 0. The actual builder regression exercises drag, gap hover, a newer Persian source edit, and the deferred old drop callback, preserving both block order and the newer text. The lint counts below remained unchanged.

Inclusive Biome comparison covers 38 changed/new frontend source and test files. Current files report 39 errors and 85 warnings (exit 1); the corresponding 35 files from `HEAD` report 39 errors and 88 warnings (exit 1). There are no increased diagnostics by file/category/severity. The remaining diagnostics are existing accessibility, test `any`, non-null assertion, and confusing-void findings. Temporary baseline copies, build logs and JSON evidence under `.tmp` were removed after verification; observed results are retained here and in the final coordinating report.

Translation boundaries use deterministic mocks. No live translation calls, production connections, environment changes, deployments, or remote pushes were performed.
