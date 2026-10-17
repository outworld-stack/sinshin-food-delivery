# Notification, coupon, order and PWA audit

Date: 2026-10-17.

## Scope

Reviewed the API services, HTTP routes, scheduled jobs, database relationships, browser checkout, notification subscription lifecycle, and production service worker. Fixed reproducible defects and added regressions around money handling, concurrency, data ownership, and recovery from interrupted requests. Existing registration/device fixes and unrelated article/admin changes were preserved.

## Fixed findings

| Area | Failure | Change |
| --- | --- | --- |
| Push destinations | User-supplied or historical subscription endpoints could cause server requests to arbitrary destinations. | Allow only known HTTPS browser push providers, reject credentials and unsupported ports, and prohibit redirects. Validate subscription keys before storing and sending. |
| Push ownership | Equivalent legacy endpoint spellings could bypass ownership handling or leave duplicate subscriptions. | Canonicalize endpoint URLs, serialize equivalent registrations/removals, merge only same-owner duplicates, and reject conflicting owners. Preserve case-sensitive paths. |
| Push delivery | Broadcast push recipients could differ from recipients whose inbox inserts succeeded. Some healthy subscriptions were disabled after provider/configuration errors. | Dispatch to the exact persisted recipients and all their active devices. Only expired subscription responses deactivate otherwise valid subscriptions. |
| Staff notifications | Live-order push could reach inactive or out-of-scope admin2 profiles. | Apply active-profile and hall/takeaway scope checks. |
| Coupon reminders | Concurrent/retried jobs could duplicate inbox entries and pushes; reminders could run for public/future coupons or after the lunch deadline. | Use the nudge UUID as the durable notification identity, dispatch only on the first insert, retain failed inserts for retry, and recheck eligibility/deadline. |
| Inbox and account changes | Cached notifications/profile data could survive an account change. Subscription state could appear enabled without server registration. | Scope inbox queries by user, clear query caches on login/logout, and verify backend subscription registration. |
| Subscription/logout races | Late subscription work could attach after logout; optional browser operations could hang. | Bound browser operations, coordinate subscription work, invalidate stale generations, and detach/unsubscribe before normal and admin2 logout. |
| Coupon codes | Persian/Arabic digits became control characters in checkout; overlong administrative codes were silently truncated. Normalized codes could shadow historical campaigns. | Share digit/case normalization, reject overlong administrative codes, and serialize uniqueness checks across historical aliases. Reject ambiguous redemption even if one stored code exactly matches the normalized input. |
| Coupon policy | Fractional/invalid parameters reached integer columns or weakened eligibility. Expiry checks accepted earlier times on the current day and mishandled Tehran/UTC boundaries. | Validate integer capacities, rule types/thresholds/IDs and exact future expiry times. Treat malformed historical rules as ineligible while preserving explicit zero-purchase rules. |
| Coupon progress | Registration age rounded up; large spending remainders overflowed a 32-bit column. | Count completed days and store reminder remainders as bigint. |
| Coupon concurrency | Checkout could use stale eligibility; edits/deletion could change reservation semantics or leave dangling order references. | Lock coupons for checkout and state changes, prevent public/private switches while reservations or uses exist, and use an order FK with `ON DELETE SET NULL`. Preserve order pricing snapshots. |
| Checkout idempotency | A committed order could lose its response record, allowing a retry to create a second order. Stale claims could modify reclaimed requests. | Commit the order and replay response in one transaction, bind keys to normalized payloads, and enforce claim tokens. Gateway URL enrichment cannot erase the durable fallback. |
| Checkout contents and totals | Missing products/sizes could silently alter baskets; negative wallet balances could increase online charges; excessive totals could overflow database amounts. | Reject stale basket contents and invalid integer totals, and clamp usable wallet funds to zero. |
| Payment attempts | Concurrent retries could create multiple pending attempts or reuse stale URLs. Aging indeterminate PSP attempts could be replaced despite uncertain settlement. | Serialize retries, use persisted gateway/amount snapshots, recheck latest payment state, and retain unresolved real-provider attempts for reconciliation. |
| Financial locks | Coupon deletion, callback settlement and refunds could acquire shared records inconsistently. | Align financial locking and exercise callback/deletion contention against PostgreSQL. |
| Reconciliation | A fixed 100-row batch could repeatedly select unresolved attempts and starve later payments. | Traverse ordered UUID batches with a cursor and wraparound. |
| Browser checkout recovery | Storage errors interrupted navigation; lost responses/remounts lost purchase identity; responses containing only an order ID appeared as failures. | Use storage-safe pending-order tracking, persist unchanged purchase keys with memory fallback, and route existing-order responses to payment recovery. Keep the key through uncertain failures and slow navigation until the matching terminal order is confirmed. |
| Checkout preview | Submission could proceed before fresh pricing was available; a second invalidation of the same coupon could be silent. | Block while preview data is missing/refetching and reset the coupon validity-transition notification state. |
| Worker deployment | The generated service worker was not reliably copied to the deployment output. | Copy the freshly built worker and verify generated/deployed bytes match. |
| Offline caching and updates | Dynamic/authenticated responses could enter caches; stale revisions remained; installed apps missed update UI; first install could trigger a reload. | Restrict caching to public build assets, clean obsolete revisions, include offline assets, show updates in standalone mode, and distinguish installation from an update. |
| Push clicks | Malformed payloads and unsafe click targets could break handling; a selected tab could disappear before focus/navigation. | Validate payloads and internal URLs, preserve safe hashes, and fall back to opening the destination. |

## Verification

The following checks passed during this audit:

| Check | Result |
| --- | --- |
| PostgreSQL notification contract (`db:test:notification`) | 14 assertions |
| PostgreSQL notification hardening (`db:test:notification-hardening`) | 48 assertions |
| Push transport (`test:push`) | Passed, including independent payload decryption and VAPID signature verification |
| PostgreSQL coupon policy (`db:test:coupon`) | 30 checks |
| PostgreSQL checkout/order safety (`db:test:order`) | 16 checks |
| Existing payment money paths (`db:test:pay`) | 38 checks |
| Populated legacy upgrade to 0011 (`db:test:checkout-coupon-migration`) | 14 checks |
| Full migration upgrade/reapply suite (`db:test:migrations`) | 65 checks |
| Browser checkout callbacks and intent persistence (`test:checkout-client`, `test:checkout-intent`) | Passed, including repeated submission while navigation is unresolved |
| Push subscription lifecycle and account-scoped notification cache | Passed |
| Existing push JSON timeout suite | 6 checks |
| Built service-worker cache, offline, push/click and artifact regressions | Passed |
| API and web TypeScript checks | Passed |
| Production PWA build, including SSR | Passed; 227 precached assets |
| Whitespace/diff checks | Passed |

Database tests used scratch databases and cleaned their fixtures. Gateways, push transport and browser APIs were mocked where external side effects would otherwise occur. Tests exercise real PostgreSQL transactions and concurrency. The checkout persistence tests load the actual helper into fresh module instances to simulate page reloads.

No real payment, SMS or push was sent. A physical browser/device session and live provider credentials were not tested. Push remains best effort after the inbox write; there is no durable outbound delivery queue. The reconciliation cursor is local to the service instance and resets on restart.

## Migration and rollout

`apps/api/drizzle/0011_previous_ulik.sql`:

1. Widens `coupon_nudges.remaining_count` to bigint.
2. Adds checkout idempotency payload hashes and claim tokens, retaining legacy rows.
3. Clears only orphan order-to-coupon references and adds `ON DELETE SET NULL`; orders and monetary snapshots remain intact.

The main database was not migrated and the application was not deployed. Before starting the updated API against a persistent database, apply the pending migration chain with `bun run db:migrate` from `apps/api`. Preserve and apply the preceding 0009/0010 migrations as required. Deploy the web output produced by `bun run build:pwa`, which includes the generated service worker.
