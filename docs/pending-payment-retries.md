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

Validation uses local scratch PostgreSQL with stubbed gateways, including
concurrent retries, callback races, ownership and amount mismatches, duplicate
receipts, definitive expiry, unresolved results, unknown gateways, lost SEP
callbacks, adapter outages, sibling verification, initialization in flight,
deadline crossings, configured replay duration and DTO server timestamps.
These tests do not contact live payment gateways. No schema migration is needed.
