# Mellat request order IDs

Reviewed and changed on the existing `main` branch from `stage hundred-twentySix`
(`96bf8fb2accdeb066dff9598980be13b2a5b915a`). No deployment, commit, production
data changes or environment changes were made. Migration execution was confined
to disposable local PostgreSQL databases.

## Provider contract and application policy

The [live Mellat interface WSDL](https://bpm.shaparak.ir/pgwchannel/services/pgw?wsdl=IPaymentGateway.wsdl)
was retrieved over HTTPS on 2026-11-06. Its `bpPayRequest` schema declares:

```xml
<xs:element name="orderId" type="xs:long" />
```

There is no separate `totalDigits`, minimum or maximum restriction on this
element. [XML Schema long](https://www.w3.org/TR/xmlschema-2/#long) has the signed
range `-9223372036854775808..9223372036854775807` and decimal integer syntax.
The previous 15-digit assumption was an implementation choice.

The user supplied the relevant public guide v1.39 (Azar 1404) facts: `orderId`
is `long`; the table's `10` is an example; every `bpPayRequest` invocation must
have a unique ID and duplicates cause an error. The guide does not specify a
separate digit limit, a formal positive minimum or a precise retention/cross-
terminal uniqueness scope. These guide facts came from the user; the WSDL and
XML Schema definition were independently retrieved. The current official portal
guide download requires login and returned HTTP 401 anonymously.

This application deliberately uses canonical positive decimal IDs and guarantees
uniqueness across all its Mellat requests, without a time or terminal reset.
Positivity is application policy. New allocations start at `281474976710656`
(`2^48`) and end at `9223372036854775807`. BigInt and exact decimal strings carry
the IDs through PostgreSQL, validation, SOAP, verification evidence and R12;
new IDs never pass through JavaScript Number.

## Root cause and database guarantee

The old generator used 12 SHA-256 hexadecimal digits: a 48-bit space, with no
collision constraint. The same UUID also reused that numeric ID if initialization
was invoked again after a failure. Every Mellat adapter revision in this repository
used the same 48-bit algorithm. Reserving the entire `0..2^48-1` space therefore
protects against all historical IDs, including requests whose responses were lost.
This avoids rewriting old payments or requiring discovery of missing PSP records.

Migration `0028_rainy_whistler.sql` adds:

- `public.mellat_order_id_seq`, bounded, incrementing, `CACHE 1`, `NO CYCLE`.
- Nullable `payments.mellat_order_id` PostgreSQL bigint.
- `payments_mellat_order_id_unique` and `payments_mellat_order_id_range`.
- An immutable-association trigger protecting an allocated ID and its payment,
  order and customer binding.
- `gateway_ref` width 128, sufficient for a 19-digit ID, separators and the
  adapter's existing 100-character token allowance (122 characters total).

PostgreSQL serializes sequence allocation across workers; the unique constraint
rejects duplicate persisted IDs even across separate transactions. The range
check excludes the whole legacy namespace. Sequence increments survive rollback,
so abandoned values are burned. Exhaustion never cycles: initiation rolls back
and returns a clear conflict without contacting the bank. The Drizzle snapshot
and journal describe the same schema; no migration 0029 was generated.

## Dispatch, recovery and compatibility

Initiation allocates the ID under the existing settlement lock order and commits
it before network activity. The callback URL and a durable dispatch marker are
saved before `bpPayRequest`. One payment record can issue at most one new Mellat
initialization: a retry requiring another bank invocation creates a fresh payment
record and obtains a fresh ID. Neither timeout nor an ambiguous response allows
the existing record to reuse or replace its ID.

Known local configuration/amount validation failures occur before SOAP and are
classified separately. A standalone initialization rejection `13` retains a safe
failure path; other unfamiliar, malformed, fault and timeout responses remain
indeterminate. Verification code `13` does not prove nonpayment. Unknown dispatched
attempts and their reservations stay protected; independent new orders can still
complete checkout and payment.

New late callbacks can recover a missing initialization response using the trusted
stored request ID and bank verification/settlement of `SaleReferenceId`. Browser
`SaleOrderId` cannot supply or retarget the association. Missing token evidence
cannot authorize a payment-page resume. Verification leases, cached evidence and
financial snapshot comparisons include the exact stored numeric ID.

Existing `orderId:t:RefId` and `orderId:s:SaleReferenceId` formats are retained.
Legacy rows keep a null allocation column and validate their old hash association;
their tokens, retries, callbacks and permanent receipts remain compatible.
Ambiguous legacy initialization records with an old `initToken` are retained for
review even if the old `initFailed` boolean is true. That flag previously covered
network failures and cannot prove nonpayment or permit assigning a new identity
to the same historical request.

Initialization metadata updates merge into current JSON and preserve callback
evidence. A callback winning the race with a slow initialization retains its
receipt and settlement; the initializer cannot return a conflicting session.
Late success on a previously failed/superseded attempt remains an original-payment
R12 review, without settling its replacement or moving wallet funds twice.

## Verification

All financial tests use local scratch PostgreSQL and stubbed PSP HTTP/SOAP.

| Command in apps/api | Passed checks/scenarios |
| --- | ---: |
| `db:test:mellat` | 113 |
| `db:test:mellat-allocation` | 13 |
| `db:test:mellat-requests` | 7 |
| `db:test:payment-recovery` | 25 |
| `db:test:payment-safety` | 53 |
| `db:test:payment-verification` | 11 |
| `db:test:order` | 23 |
| `db:test:pay` | 38 |
| `db:test:payment-disable` | 11 |
| `db:test:financial-reconcile` | 11 |
| `db:test:wallet` | 10 |
| `db:test:migrations` | 82 |
| `scripts/test-coupon-upgrade-migration.ts` | 4 |
| `db:test:zarinpal` | 72 |
| `db:test:sep` | 57 |

Allocator coverage includes 512 concurrent allocations across separate worker
pools, separate transactions, explicit duplicate rejection, immutable bindings,
rollback gaps, legacy upgrade preservation, exact upper-bound storage and
exhaustion. Request coverage uses 16 concurrent actual service initializations
and tests timeout/retry, multiple attempts, callback races, original-only settlement,
legacy verification, independent new checkout and maximum-length references.

The request-test fixture fixes availability to open and constructs orders
sequentially to avoid unrelated Bun Windows settings/concurrent-read failures.
Allocation and bank requests remain concurrent; money, order and user locks are
real. Existing payment-disable tests exercise availability behavior separately.

API, web and shared type checks, Drizzle migration check, read-only schema/snapshot
comparison and `git diff --check` passed. No live financial PSP requests were made;
only public documentation was retrieved. Existing historical hash collisions, if
any, are not retroactively repaired. Legacy requests missing conclusive association
or PSP evidence can still require manual review; independent new payments remain
available.

## Exact changed files

```text
apps/api/drizzle/0028_rainy_whistler.sql
apps/api/drizzle/meta/0028_snapshot.json
apps/api/drizzle/meta/_journal.json
apps/api/package.json
apps/api/src/infra/db/schema/payments.ts
apps/api/src/domain/payment/gateway.types.ts
apps/api/src/domain/payment/mellat.adapter.ts
apps/api/src/domain/payment/payment.service.ts
apps/api/src/domain/payment/payment-verification.ts
apps/api/scripts/test-mellat-allocation.ts
apps/api/scripts/test-mellat-request-safety.ts
apps/api/scripts/test-mellat-verify.ts
apps/api/scripts/test-payment-safety.ts
apps/api/scripts/test-migrations.ts
apps/api/scripts/test-coupon-upgrade-migration.ts
docs/pending-payment-retries.md
docs/mellat-order-id-allocation.md
```

Zarinpal and SEP adapters, settlement locks, deployment configuration and
environment files were not changed.
