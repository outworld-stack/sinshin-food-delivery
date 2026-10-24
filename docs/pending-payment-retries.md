# Pending payment retries

An authenticated order owner can use **Continue payment** while the order is
`PENDING_PAYMENT`. This applies to Zarinpal, SEP and Mellat. Since stage-98 this
explicit retry flow lives inside the payment window:
`PENDING_ORDER_EXPIRY_MINUTES` (default 10 minutes) from order creation,
aligned with the 10–15 minute lifetime of bank tokens. Checkout's
cached-response grace is pinned to the same window (`CHECKOUT_REPLAY_GRACE_MS`:
15 → 10 minutes): a stale replay never receives a bank token for an order whose
window is already closed.

Retries check the previous bank result before replacing an attempt. A successful
verification settles the existing payment. An inconclusive result or network
outage reopens the same bank session when its saved token is available. Only a
definitively unsuccessful attempt, or an initialization that can safely be
superseded, permits creating a new one. Concurrent retries and callbacks recheck
payment state, ownership and amounts under the settlement locks; wallet holds
and coupon reservations remain attached to the order.

Zarinpal authority and Mellat initialization references can recover a missing
saved URL without another bank initialization. SEP requires the original saved
Token URL: its later RefNum is a receipt, not a replacement payment-page token.
Saved destinations must match the supported HTTPS gateway endpoints. Where an
initialization reference is stored, the URL token must match it. Mellat handoff
uses a browser form POST containing `RefId` to
`https://bpm.shaparak.ir/pgwchannel/startpay.mellat` for both checkout and retries.

Bank token expiry remains controlled by the provider. Reopening a link cannot
extend a provider's token lifetime. An expired session with an unknown payment
result must still be reconciled before money moves: age alone never authorizes
a new charge or releases held funds — stage-98 only turns age into a decision
point that routes through the same verify/finalize path (see below). Existing
R12 findings identify unresolved attempts requiring provider review. Pending
orders with an already successful payment are also blocked from retry and
flagged for review.

## stage-98 — Payment window («پنجرهٔ پرداخت»)

Orders no longer sit in `PENDING_PAYMENT` forever. The payment-timeout job now
runs every 60 seconds (previously every 5 minutes) and, before the unchanged
30-minute `reconcilePending` pass, runs `PaymentService.expirePendingOrders()`:
a sweep that definitively closes every `PENDING_PAYMENT` order older than
`PENDING_ORDER_EXPIRY_MINUTES` (default 10). Order age is measured from the
order itself, not from the newest payment row, so a fresh retry cannot reopen a
closed window.

Expiry performs exactly one live verification of the newest `PENDING` attempt.
A paid verdict settles the order — the money was taken and the callback was
merely lost. An indeterminate or definitively failed verdict after the window
means the provider itself has made completion impossible, so "unpaid" is
proven: the order is canceled through the same atomically tested failPayment
path (order `CANCELED` + payment `FAILED`, wallet hold returned, coupon and
grant reservations released) with an honest notification that the window ended
and the customer should order again. A network error during that verification
defers the order to the next sweep instead of blind-failing. Leftover sibling
`PENDING` rows are superseded with fail source `expiry-sibling` so later passes
do not raise R12 noise for them.

The retry gate enforces the same window inline: `retryInitiation` on an order
past the TTL first runs the same single live verify, then answers 409 — a
settlement notice if the verify says paid («این سفارش هم‌اکنون پرداخت شد —
وضعیت صفحه به‌روز می‌شود.»), otherwise the re-order message «پنجرهٔ پرداخت این
سفارش به پایان رسید و سفارش لغو شد — لطفاً دوباره سفارش ثبت کنید.». The R12
late-success net is untouched and remains the final safety net: expiry never
moves money on its own — only the gateway verdict does — and a late PSP
success after expiry still lands in R12 for review instead of being lost.

Customers see the same window: the order DTO carries `pendingExpiresAt`
(creation + TTL, `PENDING_PAYMENT` only) for the countdown in the payment box,
and never-paid canceled orders (`CANCELED` + `FAILED`) are hidden from
customer-facing order lists while the audit rows stay.

Validation includes real local PostgreSQL transactions with stubbed bank calls
(60-day-old sessions for all three gateways, races, ownership, amount changes and
duplicate-payment guards), gateway adapter tests, URL rejection tests, and
checkout/retry browser tests, plus six stage-98 expiry scenarios in the
payment-safety suite (sweep expiry with the exact hold returned once, inline
retry expiry with the 409 re-order answer, verify-says-paid settlement,
in-window orders untouched, `expiry-sibling` supersede, verify outage deferring
to the next sweep). These tests do not contact live payment gateways.
No schema migration is required.
