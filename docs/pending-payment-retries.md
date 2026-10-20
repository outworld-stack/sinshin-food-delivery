# Pending payment retries

An authenticated order owner can use **Continue payment** while the order is
`PENDING_PAYMENT`, without an application age cutoff. This applies to Zarinpal,
SEP and Mellat. Checkout's 15-minute cached-response policy does not limit this
explicit retry flow.

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
result must be reconciled before a new payable attempt can be created; age alone
never authorizes a new charge or releases held funds. Existing R12 findings
identify unresolved attempts requiring provider review. Pending orders with an
already successful payment are also blocked from retry and flagged for review.

Validation includes real local PostgreSQL transactions with stubbed bank calls
(60-day-old sessions for all three gateways, races, ownership, amount changes and
duplicate-payment guards), gateway adapter tests, URL rejection tests, and
checkout/retry browser tests. These tests do not contact live payment gateways.
No schema migration is required.
