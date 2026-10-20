# Review of stages 91–92 and printer/location/courier flows

Reviewed commits `2a4b645` and `90b16b4`, plus the connected printing, address,
map API, delivery-zone, dispatch, GPS, and reporting code. The full customer
phone on staff invoices remains intentional; its existing regression passes.

## Functional fixes

| Area | Defect and resulting behavior |
| --- | --- |
| Printer selection | Opening the main administrator's print center now automatically scans reachable network printers. Detected printers appear in both dining/sales and kitchen dropdowns. Selecting one registers it and saves that section's default. A rescan button handles devices connected later. |
| Printer configuration | Paper width and cutter settings can be edited. Concurrent registration from different stations recovers the already-created printer. Null stored assignment settings are handled safely. |
| Printer transport | Concurrent receipt, test, and status operations are serialized per printer to prevent simultaneous jobs. Concurrent status probes and identical scans share their pending work. |
| Map initialization | Four independent CDN loaders are replaced by one retryable loader. Delayed initialization reads the latest coordinates. Failed SDK/WebGL/style initialization exposes a usable fallback. |
| Coordinate/address editing | Obsolete reverse-geocoding requests and timers are canceled. Wrapped map longitudes are normalized. Profile refetches preserve address drafts. Empty/invalid manual coordinates prevent saving an old position. |
| Geo API | Full-precision GPS coordinates and valid zero-coordinate pairs are accepted. Malformed pairs, invalid upstream payloads, mismatched matrices, malformed polylines, and nonfinite route metrics fail safely. Routes sum every leg. |
| Tracking maps | Markers represent actual positions and wait for map readiness. Late GPS is supported. Stale destination routes are canceled; route refreshes are limited to once per minute and use the latest location. Destination/navigation links remain available when the embedded map cannot load. |
| Courier workflow | Dispatch and reassignment use conditional database updates. A reassignment cannot overwrite a successful scan. Secure/tracked dispatch needs an assigned courier; open untracked scans remain supported. GPS uploads require the assigned courier regardless of QR security mode. |
| Courier sessions | Login returns to the original scanned order; OTP resend works. Expired authentication, completed delivery, and denied GPS stop tracking. Storage failures retain a usable in-memory session. |
| Delivery history | Dispatch creates a trip; customer confirmation atomically records delivery history and closes the last active delivery's trip. Repeated confirmations are idempotent. Refunds also close an idle trip. |
| Courier reports | Historical date ranges and totals use the complete requested range. Cards receive only two recent deliveries per courier. Level-2 administrators see their own delivery records, and order links use public display IDs. |
| Delivery zones | Rejected additions/removals are no longer reported or audited as successes. Duplicate creation, edits, and concurrent removals are safe; the last zone cannot be removed. Fees must be valid integers. |

## Performance changes

- Shared SDK loading and near-viewport initialization for article maps.
- Shared pending requests and bounded cache eviction for Neshan calls.
- Stable coordinate dependencies avoid rebuilding maps on equivalent object props.
- Limited route refreshes and at most one courier GPS upload in flight.
- Bounded printer discovery (512 hosts/subnet, 2,048 total, 64 sockets at once),
  shared scans/probes, and a 30-second UI discovery cache.
- Coalesced delivery-zone reads with invalidation that cannot be overwritten by
  an older pending read; checkout transactions still read fresh database values.
- SQL report aggregation with bounded previews, stable pagination, and linear
  grouping of delivery history.

## Validation

Run the following from the corresponding application directory:

| Application | Commands |
| --- | --- |
| API | `bun run typecheck`, `bun run test:maps`, `bun run test:courier`, `bun run test:print-transport` |
| API, local PostgreSQL | `bun run db:test:delivery`, `bun run db:test:courier`, `bun run db:test:order`, `bun run db:test:wallet`, `bun run db:test:print` |
| Web | `bun run typecheck`, `bun run test:maps`, `bun run test:courier`, `bun run test:printing`, `bun run test:articles`, `bun run test:checkout-client`, `bun run build` |

Database tests create and remove their own scratch databases; they were run
against a separate local PostgreSQL 18.6 container. Printer integration tests
use a local TCP device simulator. Map tests exercise SDK lifecycles and provider
responses without external provider requests.

## Operational boundaries

Printer discovery uses the existing ESC/POS TCP 9100 transport. The API must have
a network route to the printers. A cloud API cannot discover a restaurant's
private LAN without a network connection to it. `PRINT_SCAN_CIDRS` can specify
reachable printer subnets when container interfaces do not identify the LAN.
USB-only or operating-system printer queues are outside this transport.

Defaults are stored server-wide, independently for dining/sales and kitchen.
Existing permissions are preserved: hardware discovery/registration is restricted
to the main administrator; authorized staff can choose registered defaults.
Newly discovered printers default to 80 mm paper and can be adjusted in printer
management.

Physical receipt output, real GPS hardware, and live Neshan browser connectivity
still need an on-site check. No schema migration or deployment is included.
Historical deliveries never recorded by the old implementation are not fabricated.
