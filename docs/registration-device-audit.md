# Registration and device audit

Completed on 2026-10-17.

## Scope

Reviewed the application's registration, OTP, registration permits, device identification and enforcement, browser authentication, and session lifecycle. Checked the local Bun/Node runtime and PostgreSQL/Redis development services; both database services reported healthy. Device findings refer to the application's device subsystem. This was not an operating-system or hardware diagnostic.

Existing article/admin work was preserved. Two small existing build blockers were corrected: the article renderer import and a nullable migration-test comparison. Stale TanStack dependency links were repaired with a frozen install without changing dependency versions or the lockfile.

## Fixed findings

| Area | Verified failure | Fix |
| --- | --- | --- |
| OTP consumption | Parallel requests could successfully verify the same code more than once. | Atomically check, count and consume the challenge in Redis. |
| OTP retry limits | The cross-code failure counter was incremented but never checked before verifying a new code. | Enforce its fixed window atomically; requesting a new code does not reset it. |
| OTP issuance | Resends extended hourly/daily windows; a delayed SMS failure could remove a newer challenge. | Reserve challenge/cooldown/budgets atomically and cancel only the originating issuance. Redis failure returns an unavailable response without sending an untracked code. |
| Distinct-phone limit | An over-limit phone was inserted into the set, so retrying it bypassed the limit. | Atomically admit only eligible phones without extending the window on every new member. |
| Registration transaction | Referral-code lookup requested another pool connection while already holding a registration transaction. A single-connection or exhausted pool could stall. | Query through the active transaction. |
| Registration permits | Permits could expire during lock waits or be issued while registration completed. Rejected registration could leave misleading bypass audit records. | Share the registration phone lock, check wall-clock expiry after acquiring the permit lock, and write bypass events inside the registration transaction. |
| Referral enforcement | A newly discovered device similarity link could escape the initial referral check. | Recheck the finalized cluster before committing the referral. |
| Device conflicts | Retrying a unique-constraint failure inside an aborted PostgreSQL transaction failed again. | Use savepoints and resolve current device identity under row locks, retaining client-ID precedence. |
| Device access and quota | Stale device snapshots could miss a block or incorrectly reject an existing device at its quota. Lowered quotas could lock out existing devices. | Refresh lookup under the phone lock, recheck blocked state under device locks, and enforce quotas before attaching a new identity. |
| Device data | Fractional browser memory values failed against an integer database column; empty client IDs caused unique conflicts; missing canvas history produced false drift flags. | Add migration 0010 for double-precision memory, normalize empty IDs, and exclude missing hashes from drift evidence. |
| Session revocation | Session issuance could race blocking/removal; logout-all updates were not atomic; refresh could update a concurrently revoked session. | Recheck user/device/identity authority under locks, make revocation transactional, and condition refresh updates on current session validity. |
| Session authentication | Legacy active sessions could survive missing device identities or blocked devices. | Validate device identity and blocked state for access and refresh authentication, and check signed device claims. |
| Browser fingerprint | Audio/hash probes could hang; invalid primary storage hid valid fallback IDs; restricted browser properties interrupted login. | Bound optional probes, validate each fallback, retain an in-memory ID, and read optional properties defensively. |
| Browser authentication | Corrupt/blocked storage or cookies could interrupt hydration and requests. Late refresh results could overwrite a new login or revive a logged-out session. | Resilient storage/cookie reads, session-generation guards, request deadlines, and correct handling of transient refresh failures. |
| Login form and labels | Phone changes retained stale registration state and pending OTP submission; Samsung Plus models were mislabeled as Ultra. | Reset dependent form state, cancel stale autosubmission, and correct model mapping. |
| Migration verification | A migration test temporarily removed real migration files and rewrote the working journal. | Run that scenario in an isolated temporary migration directory. |

## Verification

All checks below passed:

| Check | Result |
| --- | --- |
| Real Redis OTP regressions (`test:otp`) | 17 checks |
| Real Redis distinct-phone limit (`test:otp-limit`) | 7 checks |
| PostgreSQL registration/permit/session integration (`db:test:permit`) | 68 checks |
| PostgreSQL device policy (`db:test:device`) | 51 checks |
| Device intelligence (`db:test:intel`) | 28 checks |
| Migration upgrade/reapply suite (`db:test:migrations`) | 65 checks |
| Browser device fingerprint (`test:device`) | 26 checks |
| Browser authentication session (`test:auth-session`) | 20 checks |
| Browser fetch timeout (`test:fetch-timeout`) | 5 checks |
| Browser auth-store and registration-client scripts | Passed |
| API and web TypeScript checks | Passed |
| Web production build, including SSR | Passed |

Tests covered real concurrent OTP consumption and refresh, permit expiration during row-lock waits, full device-quota enforcement through authentication, and database-trigger failures proving transactional rollback. Database integration tests used temporary databases; Redis tests used isolated keys. Audit-created database/key fixtures were cleaned up. SMS delivery was stubbed; the live SMS provider and physical browsers were not exercised.

## Applying the changes

Migration `apps/api/drizzle/0010_military_scorpion.sql` changes only `devices.device_memory` to double precision. Its upgrade and repeat-run behavior were verified, including preserving existing integer values and storing 0.25 GB. The existing 0009 migration was preserved.

The main database was not migrated and the application was not deployed. Before running the updated API against a persistent database, apply the pending migration chain using `bun run db:migrate` from `apps/api`.

New API code accepts OTP challenges issued by the old code. Newly issued challenges contain an issuance suffix for safe cancellation; old API processes cannot verify that format. Restart the API consistently rather than serving old and new workers together during rollout.
