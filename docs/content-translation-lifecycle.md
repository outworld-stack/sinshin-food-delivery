# Database translation inventory

Baseline: article field translation commit `2723c083e1151b09bebf03026bcfe4cbb1d1326f`.
This change is isolated on `feat/content-field-translation-lifecycle`.

The inventory was inspected before implementation. Static dictionaries in `apps/web/src/i18n/{fa,ar,index,seo,apiErrors}` remain separate from database content.

| Entity | Arabic-capable fields | Persistence and public paths | Admin paths | Implementation status |
|---|---|---|---|---|
| Products | name/nameAr, description/descriptionAr, each ingredients/ingredientsAr entry | infra/db/schema/menu.ts; domain/menu/menu.service.ts; domain/cart/cart.service.ts | ProductForm.tsx; server/products.ts | Implemented: independent proofs, invalidation, worker, targeted editor, list/detail/cart fallback |
| Product sizes | name/nameAr per size UUID | infra/db/schema/menu.ts; domain/menu/menu.service.ts; domain/cart/cart.service.ts | ProductForm.tsx size rows | Implemented: stable IDs, independent provenance and deduplicated size jobs |
| Main categories | name/nameAr | infra/db/schema/menu.ts; domain/menu/menu.service.ts | products/MainCategoryManager.tsx | Implemented: edit route, source proof, field controls and public fallback |
| Categories | name/nameAr, each sizeNames/sizeNamesAr template | infra/db/schema/menu.ts; domain/menu/menu.service.ts | products/CategoryManager.tsx | Implemented: independent template identities, reorder handling and fallback |
| Packaging items | title/titleAr | infra/db/schema/menu.ts; domain/menu/packaging.service.ts | products/PackagingItemsManager.tsx | Implemented: independent title proof and editor; admin-only data, prices untouched |
| Articles | title/titleAr, excerpt/excerptAr, content/contentAr, each processes/processesAr title/item | infra/db/schema/articles.ts; domain/article/article.service.ts | ArticleForm.tsx | Implemented: scalar/process lifecycle; builder content text derived without a second translation request |
| Article blocks | blocksAr textual whitelist (hero, heading, paragraph, image, gallery, quote, callout, list, CTA, link, location; divider has no text) | shared/block-translations; article.service/translation.service | ArticlePageBuilder/useArabicBlockTranslations | Existing format, source proof and concurrency protections retained |
| Article taxonomy | category/subcategory name/nameAr per UUID | infra/db/schema/articles.ts; domain/article/article.service.ts | articles/ArticleCategoryManager.tsx | Implemented: stable child IDs, independent proof and public/admin separation |
| About | heroTitle/heroTitleAr, heroText/heroTextAr, teamTitle/teamTitleAr, teamAlt/teamAltAr, location.address/addressAr, all blocks/blocksAr textual fields | infra/db/schema/settings.ts; http/routes/about.routes.ts | settings/AboutContentForm.tsx | Implemented: scalar/address workers, existing block primitives and partial public merge |
| Terms | sections/sectionsAr section titles and individual items | infra/db/schema/settings.ts; domain/terms/terms.service.ts; http/routes/terms.routes.ts | settings/TermsEditor.tsx | Implemented: nested identities and source proofs, immutable version carry-forward, per-item fallback |
| Gallery | alt/altAr per image UUID | infra/db/schema/gallery.ts; domain/gallery/gallery.service.ts | settings/GalleryManager.tsx; settings/GalleryImageRow.tsx | Implemented: independent image alt lifecycle; image metadata does not invalidate text |
| Temporary closure message | settings temporary_close_reason/temporary_close_reason_ar | domain/settings/settings.service.ts; domain/admin2/admin2.service.ts; http/routes/admin-settings.routes.ts | settings/TemporaryCloseCard.tsx | Implemented: atomic message/proof persistence and fallback; closure/payment policy preserved |

All API paths above are under `apps/api/src`; admin components are under `apps/web/src/components/admin`.

Other inspected text has no Arabic editing column: personal/user/courier names and addresses, reviews, printer/device labels, transaction/order snapshots, wallet ledger descriptions, coupon titles and notification payloads. Personal content, historical snapshots and operational messages retain their existing semantics. This lifecycle handles the complete existing Arabic-capable editorial/message field inventory; it does not alter payment, order, notification or authentication business rules.

## Existing lifecycle and gaps found

The queue has nine entity types and run methods in `domain/translation/translation.service.ts`. Product/About/gallery workers relied on record-wide `arAuto`; category workers only checked null; ingredients/templates/terms/processes translated whole arrays. Products erased omitted Arabic fields and renamed sizes by replacing rows. About used `blocksAr ?? blocks` and sanitized Arabic as Persian, stripping source proof. Terms frontend reselected whole Arabic sections and filtered placeholders. SEO and cart independently preferred raw Arabic.

Source writes were found in entity services/routes, the translator worker, `drizzle/seed.ts`, `seed.deploy.ts` and article initialization. The product seed backfill filled three fields when only nameAr was missing, risking manual sibling values. Seed changes must be independently source-checked and preserve existing values. Imports were searched; no separate content import service was found.

## Common contract

An additive `translation_state` JSONB column holds `{version, entityType, entityId, fields}`. Each field records identity, current path, exact source text, origin (`manual`, `automatic`, conservative `legacy`), status, revision, recoverable stale text/source and an optional failure. Actual Arabic remains in its existing column. Removed or ambiguous collection drafts have a bounded optional `orphanedFields` archive. Block provenance remains inside the existing `blocksAr.translation` format; no parallel block document is introduced.

Source changes invalidate exactly one identity. Explicit editor edits carry source/revision proof; unchanged Arabic form values are never proof of review. Compact SHA-256 form tokens bind the persisted editable row and a durable write revision without duplicating large documents in save requests. Existing admin saves require the current server-issued token, including metadata-only changes. Automatic persistence rereads under the parent row lock and accepts only matching source/revision and eligible fields. A stable collection field can move while its result is pending; the result is applied at its latest validated path. Legacy populated values remain conservative/manual; migration never erases them. Collections now persist explicit ordered item IDs in the existing sidecar and require those identities on array updates; changed text and array positions never prove item ownership. Retired IDs cannot attach a removed translation to replacement content. Article/About list and gallery items use the shared block identity format. Incomplete provenance preserves populated raw Arabic as a recoverable review draft before hiding it publicly. The complete save/alternate-write audit is documented in [content-hardening-backend-audit.md](content-hardening-backend-audit.md).

Migration `apps/api/drizzle/0027_rare_silverclaw.sql`, its generated snapshot and journal add nullable sidecars to all twelve tables. Provenance is bound lazily on the first safe save/worker write; populated legacy Arabic is preserved regardless of `arAuto`. No migration attempts to guess the historical source of an Arabic value or replace existing translations. The legacy upgrade regression constructs a pre-0027 database, compares stored content before/after, and tests subsequent conservative reconciliation.

The common whitelist and reconciliation live in `packages/shared/src/content-translations.ts`; explicit table persistence lives in `apps/api/src/domain/translation/content-translation.store.ts`. `content-translation.worker.ts` shares the existing translator/Markdown planner and block helpers, sends only each selected source field, and rejects obsolete responses. Entity queue jobs retain pending deduplication and use serialized claim/retry transitions, running-attempt fencing and pending successor jobs. Record-wide `arAuto` is only a compatibility badge.

`POST /admin/translate/field` validates exact stored identity/path/source/revision. Existing block previews remain compatible; persisted block-field previews additionally validate entity identity and block revision. Unsaved drafts use one-field previews and must supply current source-bound proof when saved. Bulk actions skip completed fields and manual drafts awaiting review. Explicit whole-document Arabic clears use empty manual field proofs in the existing block format so running jobs cannot refill them.

The block text whitelist is shared by Articles and About:

| Block type | Text paths in props |
|---|---|
| hero | title, text |
| heading, paragraph | text |
| image | alt, caption |
| gallery | images[index].alt |
| quote | text, author |
| callout | title, text |
| list | items[index] |
| cta, link | title, text, label |
| location | title, address |
| divider | none |

IDs, types, order, coordinates, sources, URLs, links, styles, widths and animations always come from the Persian document.

## Cache inventory

Menu has versioned Redis/ETag caches plus SSE invalidation; product mutation invalidators cover lists/details/similar/cart/checkout/admin. Packaging has a 30-second list cache and menu notification. Articles use `articles:ver`/`arts`, including language in list keys. About/gallery/terms have no API content cache; frontend public/admin query keys must be invalidated after persistence. Settings has a 30-second write-through KV cache. Translation completion must refresh affected content query prefixes, beyond queue status alone.

Public DTOs must filter invalid raw Arabic as well as localize primary fields, preserve per-field Persian fallback and exclude provenance. Language-sensitive query keys, SSR headers, canonical/hreflang/JSON-LD and static UI dictionaries remain unchanged.

## Final reconciliation

Every Arabic-capable database column and the additional closure-message KV pair found in the inventory now has an explicit save, worker, editor and fallback path. Static dictionaries and non-Arabic historical/operational content remain outside this lifecycle. Seed source files only fill compatible, unprovenanced, matching-source Arabic gaps; neither seed script was executed against development or production data.

Executed validation and the existing lint limitations are recorded in [content-translation-validation.md](content-translation-validation.md). All database regressions use disposable local PostgreSQL databases; translators are deterministic mocks. No production database, environment, deployment or remote repository was changed.
