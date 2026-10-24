# Step ninety-six review

Reviewed commit `275dae9` (`stage ninety-six`) and its affected call paths.
The commit's source comments and reference section call the same changes
`stage-98`; this review uses the Git commit as its scope.

## Requirements inferred from the changes

1. Stop starting or resuming payment after a configurable window, defaulting to
   ten minutes from order creation. Reconcile abandoned orders, release funds
   and coupon/grant reservations only when justified, and retain audit history.
   Hide never-paid canceled orders from customer lists and exclude pending
   orders from the relevant business counts and reports.
2. Put recently changed products first in the admin list, return the admin to
   page one after successful changes, and show ten products per page by default.
3. Route article readers from their actual GPS location to the article location.
   If GPS is unavailable or denied, let them select their origin in Neshan.
   Courier links should use the active courier position, with the documented
   restaurant fallback when no active position exists.

## Findings and implemented corrections

| Priority | Defect and consequence | Correction |
| --- | --- | --- |
| High | Expiry treated an indeterminate bank response as proof of nonpayment. Missing SEP receipts, removed gateways and adapters that convert network errors into indeterminate results could cancel a possibly paid order and return its wallet hold. | Preserve reservations and record R12 review findings until the bank result is conclusive. A deadline or expired token cannot prove that an earlier charge did not occur. |
| High | Expiry verified only the newest pending attempt and suppressed its siblings. A successful or unresolved older charge could be lost. | Inspect all outstanding attempts and existing successful payments. Revalidate the complete attempt snapshot under transaction locks before cancellation; close proven-unpaid siblings atomically with the order. |
| High | Failure callbacks and older reconciliation could bypass the new expiry protections. | An individually failed callback persists its own failed attempt and receipt while unresolved siblings retain the order's reservations. Only the last definitive failure cancels. The older reconciliation pass uses the same full-order expiry checks. |
| Medium | Checkout replay used a fixed grace and payment-row age, while initiation, network delays and lock waits could cross the order deadline. | Enforce the configured order-creation deadline for initialization, retry and replay, including final return checks. Retain late initialization references for reconciliation without exposing a new payment URL. Validate the configured duration. |
| Medium | The countdown used the device clock and rendered time-sensitive content during hydration. At zero it asserted cancellation, no bank debit and released reservations without confirmation. | Add `pendingCheckedAt` server time, advance with the browser's monotonic clock, handle legacy/invalid timestamps, stop expired timers, and show that payment verification is still pending. Update Persian and Arabic copy and cancellation notifications. |
| Medium | Products with identical modification and creation timestamps had unstable page boundaries. Inline mutations on later pages did not return to page one; old URL limits disagreed with the selector. | Add the unique product ID as a sort tie-breaker, return to page one after successful mutations, preserve filters, and normalize supported page sizes to 10/20/50. |
| Medium | Opening a new tab inside an asynchronous GPS callback could be blocked by the browser. Duplicate clicks and stale callbacks could navigate unexpectedly. | Navigate in the current tab after GPS resolves. Guard concurrent requests and ignore results after unmount or destination changes. Preserve the destination-only fallback. |
| Medium | Courier position survived stopping or restarting tracking, allowing an old coordinate to appear as the active routing origin. | Clear the position on manual stop, provider/permission stop and restart; retain existing map instances when GPS updates. |

Performance changes also keep category membership filtering inside SQL instead
of materializing every linked product ID, execute independent product count and
page queries concurrently, and process expiry in rotating batches of up to
50 orders instead of an unbounded sweep.

## Verification

All checks below passed on the working changes:

| Area | Checks |
| --- | --- |
| Compilation | API, web and shared TypeScript checks; production web build |
| Payment | 53 payment-safety scenarios; 38 money-path checks |
| Order and accounting | 17 order-safety scenarios; 11 financial-reconciliation scenarios; 10 wallet-safety scenarios; 30 coupon-policy checks |
| Product backend | 9 admin-product ordering scenarios; 9 menu-safety scenarios |
| Gateway adapters | Zarinpal 16, SEP 40 and Mellat 30 checks |
| Frontend | Payment target/retry/window, articles, maps, courier, product/admin-product, checkout and financial-cache scripts |
| Static checks | Focused Biome checks for the changed payment and article buttons; `git diff --check` |

Database suites use isolated local PostgreSQL databases. Gateway requests are
stubbed; no real bank charges or live Neshan/device-GPS tests were performed.
Frontend GPS, timing and lifecycle regressions use controlled browser/React
hosts. Repository-wide lint was not claimed as passing.

## Operational limits

The window is a deadline for starting or resuming payment, not a guarantee that
every bank result becomes known at ten minutes. Token-only sessions with lost
callbacks may require provider/manual review. They deliberately retain funds
and reservations while unresolved. Slow providers and large backlogs can delay
the worker beyond its one-minute schedule.

No schema migration is required. The new DTO field is optional for compatibility
with mixed deployments. Code changes are left uncommitted for review.
