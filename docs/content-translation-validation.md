# Content translation validation

Validated locally on `feat/content-field-translation-lifecycle`, based on article commit `2723c083e1151b09bebf03026bcfe4cbb1d1326f`.

## API and shared regressions

Commands below run from `apps/api` with the repository-required `rtk proxy` prefix. Each reported pass was executed and returned exit code 0.

| Command | Observed result |
|---|---|
| `bun run test:content-shared` | 56 shared regression groups; compact source revision suite passed |
| `bun run db:test:content-products` | 13 passed |
| `bun run db:test:content-entities` | 13 passed |
| `bun run db:test:content-worker` | 42 passed |
| `bun run db:test:content-migration` | 24 passed |
| `bun run db:test:block-translations` | 48 passed |
| `bun run db:test:articles` | 50 passed |
| `bun run db:test:about` | 12 passed |
| `bun run db:test:blocks` | 82 block normalization checks and pure block translation regressions passed |
| `bun run db:test:migrations` | 82 passed |
| `bun run db:test:menu` | 9 passed |
| `bun run db:test:products-order` | 9 passed |
| `bun run db:test:purchase` | 7 passed |
| `bun run test:temporary-close` | Passed |
| `bun run test:restaurant-hours` | Passed |
| `bun run typecheck` | Passed |
| `bun build ./src/index.ts --target=bun --outdir ../../.tmp/content-api-build` | Passed: 670 modules, 2.29 MB entry bundle |

The worker, entity, article, About, block, product, menu and legacy migration suites were rerun after the final shared provenance fixes. The shared suite and API TypeScript check were rerun after compact source revisions were added. Expected unsafe-block and simulated failed-view-write fixture logs do not represent failing tests.

The legacy migration test creates pre-0027 records in a disposable local database, verifies unchanged Persian/Arabic data across all twelve additive columns, tests migration idempotency, and checks conservative lazy binding. No normal development database was migrated.

The compact revision suite compares synchronous shared SHA-256 against Bun's platform implementation for standard, Unicode, padding-boundary and million-character inputs. It checks a large legacy terms document, exact source changes, manual revisions and compatibility with earlier exact tokens. HTTP schema validation also accepts all 10,100 independently editable fields permitted by the existing maximum terms structure.

## Frontend validation

Commands run from `apps/web` with `rtk proxy`. Each reported pass returned exit code 0.

| Command | Observed result |
|---|---|
| `bun run test:products` | All five scripts passed |
| `bun run test:articles` | All five scripts passed |
| `bun run test:about` | Passed |
| `bun run test:seo` | All scripts passed |
| `bun run test:temporary-close` | Passed |
| `bun run test:content-translations` | All four scripts passed, including nine queue refresh regressions |
| `bun run typecheck` | Passed |
| `bun run build` | Passed: 3,500 client modules, 542 SSR modules and 3,302 Nitro modules |

Articles, About, content translations, TypeScript, inclusive lint comparison and the production build were rerun after the final block proof/manual-clear fix. Products and static SEO behavior passed in the complete frontend run before that narrow block editor fix.

The final build's only warning is Vite's existing chunks-over-500-kB warning: the main client bundle is 524.33 kB and the existing Neshan SDK chunk is 1,638.24 kB. No other build warnings or errors were observed. Windows initially blocked Vite's subprocess under the sandbox; the approved rerun outside the sandbox returned exit code 0.

Focused regressions verify independent unsaved size identities, exact one-field payloads, child-only manual terms/process edits through new sibling insertion and reorder, updated queue errors/completed statuses in mounted drafts, late failed requests, per-field block progress/retry, manual draft recovery and skip behavior, saved block source proofs, exact coordinates and late/unmounted responses. Save-level block tests cover multiple Persian/Arabic keystrokes, changed-field manual empty values, whole-document clears, and reviewing one field while preserving every other clear.

## Lint results

The installed executable `apps/web/node_modules/.bin/biome.exe` was used. No dependencies were downloaded for linting.

- Inclusive lint across all 31 affected/new API and shared production source files returned exit code 1: two existing `noAssignInExpressions` errors in `apps/api/src/index.ts`, plus twelve existing `noNonNullAssertion` warnings in cart (1), gallery (2), and menu (9).
- The committed HEAD copies of those four files were linted with the same configuration: the exact same two errors and twelve warnings, exit code 1. No new diagnostics were introduced in those modules.
- Core translation files and shared block/content helpers passed scoped lint with zero diagnostics.
- All six new API regression scripts passed inclusive lint with zero diagnostics.
- The new source fingerprint helper, revision functions and regression script passed scoped inclusive lint with zero diagnostics.
- Frontend inclusive lint compared all 39 changed/new TypeScript files against exact HEAD copies: 32 existing files and seven new files. The comparison passed with zero added diagnostics and zero diagnostics in new files. Both raw Biome runs returned exit code 1 with the identical pre-existing 31 errors and 88 warnings (119 diagnostics each); these include existing accessibility errors and older test assertions.
- The existing API block regression script retains 59 non-null assertion warnings; scoped lint returned exit code 0 and the new database regression added no warnings.

An explicit temporary configuration extending the existing web Biome configuration with TypeScript/TSX includes was used for script lint; the normal web configuration excludes those scripts. The frontend comparison dynamically inventoried all changed/new source and test files and applied the same rules to committed baselines. Temporary configurations, baseline copies and build outputs are removed after recording validation.

## Final review and safety

The final review covered the inventory, translation whitelist, public DTOs, admin save proofs, queue ownership and successor jobs, per-field failures, caches, nested identities, block structure and legacy data. It found and corrected recoverable Arabic draft loss from incomplete provenance, inconsistent new parent/child identities, unsaved product size IDs, and oversized source tokens. Frontend checks also cover partial-job refresh, explicit field loading/failure feedback and preserving untouched drafts during server metadata refresh. Local block race counters remain separate from saved review proofs; multiple keystrokes do not advance the saved proof repeatedly. Empty manual values require exact current source/revision proof and remain ineligible for automatic refill.

All translation regressions use deterministic mock translators. No live paid translation calls, seed execution, production database access, environment/secret changes, remote push or deployment occurred. The additive migration is provided for review and was tested only in disposable local databases. Static Arabic dictionaries and order/payment/delivery business rules remain unchanged.
