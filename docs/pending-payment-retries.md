# Pending payment retries

An authenticated order owner can use **Continue payment** while the order is
`PENDING_PAYMENT` and its payment window remains open. This applies to Zarinpal,
SEP and Mellat. `PENDING_ORDER_EXPIRY_MINUTES` defaults to 10 minutes from order
creation; configuration accepts whole minutes from 1 through 1440 and falls back
to 10 for invalid values. Retrying never restarts this clock.

Initialization, retry and checkout replay enforce the same order deadline.
Retry rechecks the deadline under settlement locks after bank verification;
initialization that finishes too late retains its reference for reconciliation
without returning a payment URL. Checkout replay also rejects a cached URL from
an older attempt and respects the configured window rather than a fixed grace.

Both backend preview and checkout reconcile the customer's expired orders before
pricing or creating a new order. Checkout rechecks outstanding orders and payment
attempts under the customer money locks. This includes returning customers and
unresolved sibling attempts on an already paid order. Initiation and retry also
reject other outstanding payments under those locks. A bank-confirmed success
settles only the original order, once; no recovery path creates another charge
while that settlement is in progress.

An unresolved expired payment allows a priced cart preview with `paymentRecovery`
and an editable saved cart, while payment submission remains blocked on both
client and server. First-purchase reservations and discounts remain tied to the
original order. A late success clears the submitted cart only when its contents
still match the original checkout; it preserves a subsequently edited draft.

Retries check previous bank results before replacing an attempt. A successful
verification settles the existing payment. An inconclusive result or network
outage can reopen the same bank session while the order window is open. Only a
definitively unsuccessful attempt, or an initialization that can safely be
superseded, permits creating a new one. Concurrent retries and callbacks recheck
payment state, ownership and amounts under settlement locks; wallet holds and
coupon reservations remain attached to the order.

Zarinpal authority and Mellat initialization references can recover a missing
saved URL without another bank initialization. SEP requires the original saved
Token URL: its later RefNum is a receipt, not a replacement payment-page token.
Saved destinations must match supported HTTPS gateway endpoints. Where an
initialization reference is stored, the URL token must match it. Mellat handoff
uses a browser form POST containing `RefId` to
`https://bpm.shaparak.ir/pgwchannel/startpay.mellat` for checkout and retries.

## Payment window and reconciliation

Bank token lifetime is controlled by the provider and is independent of the
order deadline. Neither an expired token nor a missing callback proves that the
customer was never charged. An unknown result must be reconciled before wallet
holds or coupon/grant reservations can be released.

The payment-timeout job runs every 60 seconds. It inspects a rotating batch of
up to 50 orders older than the configured window, then runs the older-attempt
reconciliation pass. Processing is bounded so a backlog of unresolved orders
does not turn one sweep into an unbounded job. Large backlogs or slow providers
can delay confirmation beyond the displayed deadline.

Verification uses a durable per-attempt database lease and exponential retry
backoff from one minute to one hour. Callback evidence bypasses the schedule;
background results are bound to the original reference, owner, amount, gateway,
mode and receipt candidate. A stale negative result cannot override newer
callback evidence. Scheduling metadata does not change the financial snapshot
revision. R12 findings are unique and recurring equivalent findings increment
at most hourly; new anomaly kinds or receipt changes can reopen/update review.

Expiry checks every pending attempt belonging to an order:

- A successful bank result settles that payment and the order. Unverified
  siblings remain available for reconciliation.
- An unknown result, provider outage, removed gateway or missing receipt keeps
  the order pending and opens an R12 finding for verification or manual review.
  This includes adapters that return `indeterminate` instead of throwing.
- Cancellation is allowed only when all pending attempts are conclusively
  unpaid, are mock payments, or have no initiated session (never started or a
  recorded initialization failure). An initialization in flight stays pending.

Before cancellation, the verified set of attempts is checked again under
settlement locks. A new attempt, changed receipt or successful payment blocks
the stale decision. Proven-unpaid siblings and the order are closed in the same
transaction; the wallet hold is returned exactly once and coupon/grant
reservations are released. The older-attempt pass uses the same full-order check
for expired pending orders, so it cannot bypass these sibling protections.
Failure callbacks also preserve the order while another attempt remains
pending: only the failed attempt and its verified receipt are recorded. The
remaining attempt can still settle; only its final failure permits cancellation.

After the deadline, retry returns 409 with the actual outcome: settled,
canceled with a request to order again, or still being verified. It never
claims cancellation for an unresolved result. Late success on a failed attempt
still raises R12 for review instead of moving the wallet twice.

The customer DTO includes `pendingExpiresAt` (creation plus configured window)
and `pendingCheckedAt` (server time), only for pending orders. The countdown can
therefore follow server time even when the customer's device clock is wrong.
Reaching zero disables initiation and communicates pending verification;
cancellation is shown only after the server confirms it. Never-paid canceled
orders (`CANCELED` + `FAILED`) are hidden from customer order lists while their
audit rows remain.

`POST /payments/reconcile` is authenticated and owner-scoped. It reports the
original order's status after safe verification and never initiates a payment.
The checkout recovery banner links to the original order and existing support
contact. R12 records include the original order and payment IDs, gateway,
reference, amount and a merchant-panel review instruction. Acknowledging an R12
finding does not classify a financial outcome or release reservations.

## Provider evidence and limitations

- Zarinpal success requires verify code 100/101. Code -51 and Inquiry FAILED
  describe an unsuccessful/incomplete attempt, without a documented guarantee
  that the authority can never charge later. A -51 response is followed by
  Inquiry; only authenticated, error-free code 100 with status REVERSED permits
  terminal failure. PAID/VERIFIED inquiry results still require verification.
  Official sources: [error codes](https://www.zarinpal.com/docs/paymentGateway/errorList.html)
  and [Inquiry](https://www.zarinpal.com/docs/paymentGateway/otherMethods/Inquiry.html).
- SEP success requires matching server reservation ID, terminal identity and
  amount. Browser receipt candidates are retained separately and verified again
  after an outage. A false verification flag, unsigned cancellation, absent
  identity or unknown response remains indeterminate. No documented terminal
  failure-code guarantee was available during this review; no new allowlist was
  assumed. Terminals omitting binding evidence require PSP review.
- Mellat success requires bank verify 0/43 followed by settle 0/45; bank code 48
  retains the existing reversed-transaction failure handling. Unsigned callback
  codes, other bank codes and outages remain indeterminate. An unverified sale
  receipt never replaces the initialization reference; retained callback
  candidates permit background recovery after verification becomes available.

No elapsed-time rule revokes an issued PSP session. If the provider cannot
establish a terminal result, support must obtain conclusive PSP evidence; the
customer's new payment stays blocked. No forced-failure or deletion endpoint was
added. Public SEP/Behpardakht documentation did not establish additional terminal
failure guarantees, and no live gateways were exercised.

Validation uses local scratch PostgreSQL with stubbed gateways, including
concurrent retries, callback races, ownership and amount mismatches, duplicate
receipts, definitive expiry, unresolved results, unknown gateways, lost SEP
callbacks, adapter outages, sibling verification, initialization in flight,
deadline crossings, configured replay duration and DTO server timestamps.
These tests do not contact live payment gateways. No schema migration is needed.

## Verified checks for this change

All commands below passed using `rtk proxy bun` from their application directory.

| API script | Passed checks/groups |
| --- | ---: |
| `db:test:payment-safety` | 53 |
| `db:test:payment-recovery` | 17 |
| `db:test:payment-verification` | 11 |
| `db:test:order` | 22 |
| `scripts/test-coupon-upgrade.ts` | 40 |
| `db:test:zarinpal` | 72 |
| `db:test:sep` | 57 |
| `db:test:mellat` | 43 |
| `db:test:pay` | 38 |
| `db:test:wallet` | 10 |
| `db:test:payment-disable` | 11 |
| `db:test:financial-reconcile` | 11 |
| `scripts/test-coupon-upgrade-migration.ts` | 4 |

Web checks passed: `test:checkout-client`, `test:payment-retry`,
`test:payment-draft`, `test:checkout-intent`, and `test:coupon-client`.
Both API and web `typecheck` passed, as did `git diff --check`.

The coupon, money-path, wallet and payment-disable test harnesses avoid a
confirmed Bun reserved-transaction stall in parallel settings reads. They use
fixture status read outside reserved transactions, refreshing dynamic disable
state after toggles. Financial locks and race barriers remain real; the cold
single-connection wallet test still exercises real settings and coupon services.
No production settings implementation was changed.

## Changed files

Backend implementation and scripts:

```text
apps/api/package.json
apps/api/src/domain/order/order.service.ts
apps/api/src/domain/payment/payment.service.ts
apps/api/src/domain/payment/payment-verification.ts
apps/api/src/domain/payment/zarinpal.adapter.ts
apps/api/src/domain/payment/sep.adapter.ts
apps/api/src/domain/payment/mellat.adapter.ts
apps/api/src/http/routes/payment.routes.ts
packages/shared/src/contracts.ts
```

Customer recovery and cart preservation:

```text
apps/web/package.json
apps/web/src/hooks/site/useCheckoutPage.ts
apps/web/src/routes/checkout/index.tsx
apps/web/src/routes/dashboard/orders/$orderId.tsx
apps/web/src/components/dashboard/order-detail/PendingPaymentBox.tsx
apps/web/src/lib/pending-checkout.ts
apps/web/src/i18n/fa.ts
apps/web/src/i18n/ar.ts
```

Regression coverage and report:

```text
apps/api/scripts/test-payment-recovery.ts
apps/api/scripts/test-payment-verification.ts
apps/api/scripts/test-payment-safety.ts
apps/api/scripts/test-payment-money-path.ts
apps/api/scripts/test-payment-disable.ts
apps/api/scripts/test-order-safety.ts
apps/api/scripts/test-coupon-upgrade.ts
apps/api/scripts/test-wallet-safety.ts
apps/api/scripts/test-zarinpal-verify.ts
apps/api/scripts/test-sep-verify.ts
apps/api/scripts/test-mellat-verify.ts
apps/web/scripts/test-checkout-client.tsx
apps/web/scripts/test-payment-window-client.tsx
apps/web/scripts/test-payment-draft-client.tsx
docs/pending-payment-retries.md
```
