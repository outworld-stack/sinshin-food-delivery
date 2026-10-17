# Payment, wallet and referral rewards audit

Date: 2026-10-17.

## Scope

Reviewed payment initiation, verification, callbacks, retries and reconciliation; all application wallet writes; checkout holds, refunds and referral credits/reversals; referral binding and reporting; financial reports; and the corresponding browser flows. Earlier registration/device and notification/coupon/order/PWA fixes remain in place. Unrelated work was preserved.

## Fixed findings

| Area | Reproducible failure | Fix |
| --- | --- | --- |
| Buyer refunds | A referral reward deposit used the same per-order unique index as the buyer refund. Refunding a referred order could set `REFUNDED` while silently skipping the buyer's credit. | Separate refund and referral-credit uniqueness in migration 0012. An unexpected buyer-credit conflict now rolls back the refund instead of silently losing money. |
| Wallet concurrency | Reward reversals did not share the checkout spending lock. Cross-user reward writes could also deadlock through foreign-key locks on user rows. | Use ordered account advisory locks for spending/reversals and compatible user row locks. Test simultaneous settlements, refunds and spending. |
| Spent rewards | Clawback after a referrer spent a reward must retain the debt without creating extra buying power. | Preserve the compensating withdrawal and negative ledger balance; subsequent checkout uses zero available wallet funds. Verify the full lifecycle. |
| Connection exhaustion | Cold settings/location/delivery lookups inside money transactions requested another database connection. A one-connection pool stalled. | Pass the active transaction through settings and delivery reads, bypassing outside cache/in-flight reads. Payment anomaly logging also occurs after releasing its transaction. |
| Duplicate payment initiation | Concurrent initiation could create multiple provider sessions. SEP's valid initialized attempt has no RefNum yet, so absence of a reference was incorrectly treated as permission to retry. | Claim initialization once and distinguish a failed initialization from a successfully issued payment URL. |
| Untrusted cancellation | Browser callback fields could cause a wallet hold to be released without proof that the provider had not captured payment. Some provider verification/configuration errors were treated as payment failure. | Keep unverified outcomes pending. Only verified payment outcomes authorize settlement or release. |
| Money validation | Invalid/fractional amounts, missing returned amounts and unsuccessful HTTP responses could cross adapter boundaries incorrectly. | Validate whole positive toman/rial amounts and verified receipt data; treat unknown/error responses as indeterminate. |
| Receipt reuse and attribution | An attempt's owner/amount could differ from its order; one successful provider receipt could settle multiple attempts. | Recheck persisted owner/amount/mode under locks, protect reference updates against concurrent changes, and serialize receipt claims across attempts. |
| Late/unknown payments | Late success for an already-failed attempt and unknown historical gateways needed durable review rather than blind state changes. | Record or reopen R12 findings with current evidence and retain uncertain funds for review. |
| Referral earnings | Profile totals summed gross rewards even after reversals. Integer aggregates overflowed above 32-bit totals. Refunded order details still displayed earned rewards. | Calculate net earnings from the linked wallet ledger, use bigint aggregates, and show zero referral profit on refunded orders. |
| Referral binding | Reciprocal or longer referral cycles could be formed concurrently. An audit-write failure could leave a link committed while the request failed. | Serialize ancestry checks/binding and commit the link with its audit event. Keep the existing device-cluster checks and reject self-reward for corrupt historical self-links. |
| Referral codes | Custom lowercase codes did not match uppercase lookup, and truncation could alter attribution. | Normalize new codes consistently, support unambiguous legacy case variants, reject invalid codes, and return a conflict for concurrent duplicate edits. |
| Referral counts/history | The loaded 200-row referral slice was presented as the total. Reward rows could link a referrer to an order they could not access. | Return the full referral count in full/light profiles, label bounded history, and expose order links only to the order owner. |
| Financial diagnostics | Valid wallet-only orders and reward reversals produced false alarms; missing refund/reward credits were not checked. Large negative totals could crash reconciliation. | Correct R2/R3/R4/R7/R8 and add report-only R13/R14 ledger checks. Refresh finding details and reopen recurring resolved findings. |
| Automatic reconciliation | R1's pre-transaction trust snapshot could become invalid before it changed money state, and historical duplicate receipts could authorize another settlement. | Recheck successful-attempt count, amount, owner, gateway/mode and unique receipt under the same financial and receipt locks before settling. |
| Revenue reports | Pending orders were included in reported paid amounts. A transaction exactly at midnight appeared in adjacent daily periods. | Count successful payment amounts and use exclusive upper bounds for scheduled reporting periods and exports. |
| Browser money state | Callback/refund transitions and failed retries could leave wallet/profile data stale. Same-frame retry clicks bypassed rendered pending state. | Refresh related queries on order financial changes and all retry outcomes; add an immediate retry guard and a clear refund-to-wallet notice. |
| Referral links and pagination | Blocked storage, direct login query links and clipboard failures lost referral data or reported false success. Pagination used only the visible page length as its total. | Add storage fallback and validated early capture, preserve URL hashes/router state, await clipboard results, and correct filtered totals and page-size controls. |

## Verification

Tests use temporary PostgreSQL databases with real transactions, locks, migrations and triggers. Provider transports and browser APIs are stubbed. Tests clean their own fixtures and do not send real payments, SMS or push notifications.

| Check | Result |
| --- | --- |
| Payment safety (`db:test:payment-safety`) | 21 integration groups passed |
| Existing payment money paths (`db:test:pay`) | 38 checks passed |
| SEP / Mellat / Zarinpal adapter regressions | 40 / 30 / 16 checks passed |
| Existing order safety (`db:test:order`) | 16 integration groups passed |
| Wallet safety (`db:test:wallet`) | 10 integration groups passed |
| Referral safety (`db:test:referral`) | 9 integration groups passed |
| Financial reconciliation/reports (`db:test:financial-reconcile`) | 11 integration groups passed |
| Migration upgrade/replay (`db:test:migrations`) | 65 checks passed, including the full 0012 chain |
| Browser referral, wallet and money-cache regressions | Passed |
| Existing browser checkout intent/client and registration regressions | Passed |
| API/web TypeScript checks | Passed |
| Production PWA build, SSR and worker regressions | Passed; 227 precached assets and identical generated/deployed workers |
| Diff whitespace checks | Passed |

Wallet tests cover referred online/mixed-payment refunds, duplicate credit prevention, rollback on a conflicting ledger row, reward calculation excluding wallet funds/coupon discounts/delivery/packaging, spent-reward reversal, reciprocal legacy referral settlements, simultaneous refunds, self-referral rejection, and cold one-connection checkout. Migration tests preserve existing reward rows and do not add historical credits.

Reconciliation tests include changing trusted payment evidence while the operation waits on a row lock, wrong-owner credits, missing/mismatched rewards and reversals, negative balances beyond 32-bit range, report totals beyond 32-bit range, and exact-midnight boundaries.

## Applying and operating the changes

Apply `0012_open_mandrill.sql` through `bun run db:migrate` from `apps/api` before starting the updated API. Keep the full preceding migration chain. Migration 0012 changes wallet uniqueness indexes; it does not rewrite balances or manufacture historical refund credits.

After rollout, review financial findings:

- **R12:** unresolved, conflicting, duplicate or late provider payment evidence.
- **R13:** buyer refund/released-wallet credit differs from the amount expected by the order.
- **R14:** referral credit/reversal differs from the recorded reward.

R13 specifically detects historical orders affected by the old refund-index defect. Historical corrections require reviewing the ledger and provider evidence; this audit did not add money to existing accounts. Application refunds credit the wallet, not the customer's bank account.

An unverified cancellation remains pending until provider reconciliation or manual review establishes the outcome. This preserves funds when a browser callback conflicts with the bank. SEP accepts supported flat and nested receipt shapes, validates supplied amount/terminal/reference fields, and checks reservation identifiers when the provider returns them. A missing reservation identifier alone does not reject an otherwise verified receipt; receipt uniqueness still prevents double credit.

Existing referral eligibility policy remains: eligible accounts may bind a referrer after registration, and attribution is evaluated at settlement.

The main database was not migrated and nothing was deployed. Live PSP credentials/contracts and physical browser/device sessions were not exercised. Passing these regressions establishes coverage of the listed behavior, not a guarantee that every possible defect has been eliminated.
