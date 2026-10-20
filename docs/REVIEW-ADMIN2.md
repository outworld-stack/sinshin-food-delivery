# Level 2 admin review

Level 2 administrators with the existing `printingManage` permission can now
discover network printers, rescan, and select a discovered printer for sales or
kitchen invoices. Selecting a discovery registers it and saves the shared default.
The permission label in the administrator editor now describes these capabilities.
The permission remains off by default; printer editing, deletion, test pages, and
server network diagnostics remain main-administrator functions.

## Verified fixes

| Area | Result |
| --- | --- |
| Printer discovery | API registration/discovery and front-end controls use the same permission. The authenticated client preserves the 90-second scan budget, including token refresh and response-body reading. |
| Printer defaults | Assignment validation, saving, and printer deletion share a database transaction lock. Deletion cleanup is atomic; reads immediately see other stations' changes. |
| Order access | Invoice access follows the same ownership/queue scope as order details. Order event streams check active permissions and ownership again during delivery. Level 2 panel events contain no unrelated order details. |
| Account changes | Admin creation/promotion is transactional, rejects protected main-admin numbers, invalidates cached profiles, and handles concurrent requests. Activation toggles are atomic. |
| Permission changes | Cached permission reads cannot overwrite newer changes. Live-order cache keys include scope. Order links, fetches, counts, and editors respect current permissions. |
| Staff records | Level 2 user-management permission cannot revoke protected staff devices or delete their addresses. |
| Translation | Enqueueing translations requires the corresponding product/category/article edit permission. Site-wide content and unrestricted bulk operations require the main administrator. |
| Live panel | Fetch errors have retry controls, queue shrinkage clamps pagination, replacement arrivals trigger alerts even when the count stays constant, and dashboard failures recover visibly. |
| Session and forms | Route guards use the refreshed role and exact section boundaries. Invalid staff sessions clear local authentication/cache state. Editors handle permission loading, denied access, missing records, and fetch failures. |
| Restaurant settings | Disabled tracking can be enabled; hourly status and toggling remain correct during temporary closure. Pending toggles cannot be submitted twice. |

## Validation

API checks:

```sh
bun run typecheck
bun run test:admin2
bun run test:print-routes
bun run test:print-transport
bun run db:test:admin2
bun run db:test:print
```

The database scripts were run against temporary local PostgreSQL 18, with separate
scratch databases that the scripts remove. The print suite uses real TCP fake
printers and passed 54 checks. The print route suite passed 80 permission scenarios
and 21 invalid-request scenarios, including checks that denied requests perform no
work. Admin database tests cover rollback, simultaneous changes, cache invalidation,
scope changes, and concurrent order confirmation.

Web checks:

```sh
bun run typecheck
bun run test:admin2
bun run test:printing
bun run test:fetch-timeout
bun run test:auth-session
bun run test:auth-store
bun run test:sse-client
bun run test:admin-day
bun run test:products
bun run test:articles
bun run build
```

No schema migration is required. Physical restaurant printers were not available
for testing. Discovery uses the existing server-to-LAN ESC/POS transport on port
9100; the API must be able to reach the printer network. USB/OS printer enumeration
is not part of this transport. Browser-dialog printing remains available.
