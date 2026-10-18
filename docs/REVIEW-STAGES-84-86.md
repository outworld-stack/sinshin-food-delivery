# Review of Stages 84–86

Reviewed commits `3f6f487` (eighty-four), `fe18079` (eighty-five), and
`e2429f6` (eighty-six), relative to `2aa4b5e`.

## Fixed defects

| Area | Failure | Correction |
| --- | --- | --- |
| Product saves | Failed packaging or size writes could leave a product partially saved. | Product, category links, packaging links, and sizes commit in one transaction. Deleted packaging selections return a validation error; selected items are protected against deletion during the save. |
| Packaging permissions | Product editors could change the legacy packaging fee without permission. | Both legacy fees and packaging selections require `canEditPackagingFee`; unauthorized updates preserve saved fees. |
| Size editing | Duplicate names matching an existing size could silently overwrite that row twice. | Create and update reject duplicate size names, with rollback of the complete product save. |
| Packaging prices | Global packaging changes left menu, product, cart, and checkout data stale. | Packaging mutations invalidate server menu caches, emit menu events, and refresh dependent browser queries. |
| Category switches | Category and parent changes left admin purchase flags and product lists stale. | Managers refresh the category, parent, purchase-state, detail, cart, and checkout caches together. |
| Product detail | The detail page continued rendering loader data after queries refreshed. | The page subscribes to its product query; changing product identity resets quantity and variant state. |
| Removed variants | Add-to-cart could submit a deleted variant ID with the replacement variant's price. | Submitted IDs come from the currently resolved variant. |
| Product forms | Query refreshes could erase drafts; inactive or deleted packaging selections could not be removed. | Draft initialization follows product identity, selected unavailable items remain removable, and pending submissions are guarded. |
| Admin product labels | Category label precedence hid the count of additional categories. | The label and additional count are composed separately. |
| Payment retries | A retry could create an attempt using a disabled gateway. | Gateway switches are checked within the retry transaction before replacing or creating attempts. Previously accepted payments still initialize and settle. |
| Settings | Busy/gateway changes left checkout previews or full status badges stale; pending gateway writes could overlap. | Dependent queries refresh after writes, and gateway controls remain disabled until refresh completes. |
| Today filter | The cache did not distinguish Tehran dates; an open page could keep yesterday's orders. | Date-specific query keys, locale-independent date formatting, and refresh at Tehran midnight or browser focus. |
| Article links | Manual history pushes intercepted navigation and did not handle resource links or search/hash semantics properly. | Router links receive separate pathname, search, and hash values; uploaded resources retain normal browser navigation. |
| QZ authentication | A matching private signing key and certificate were shipped in the public browser bundle. | Both are removed. QZ's supported unsigned approval protocol is used. |
| QZ connections | Concurrent connections and delayed socket-close events could disrupt a newer connection. | Connection attempts are shared, socket handlers are scoped to their connection, and pending requests are cleaned up. |
| Browser printing | Blocking `print()` could fire completion before listeners were installed, leaving the UI locked. Errors, font waits, and iOS title restoration were unreliable. | Listeners are installed before printing; failures reject; font waits are bounded; titles/listeners/timers are restored; document printing is serialized. |
| Receipt rendering | Monochrome table headers could become black text on a black background. | Header foreground and background remain readable. |
| Print previews | Scaling ran before the preview existed, and previews from the previous order could remain visible. | Scaling follows HTML readiness; changing orders clears old invoice and preview data. |
| Courier scans | Simultaneous scans could report failure after another scan succeeded; missing scan timestamps bypassed expiry. | A bounded retry rechecks current authorization/status; rescans require a valid timestamp within three hours. |
| Courier tracking | Late requests could create a GPS watcher after navigation or unmount; rejected updates counted as successful sends. | Cleanup invalidates pending scan/update callbacks, route changes reset state, and only accepted updates increase the count. |

Cart detail reads also skip the packaging-price join that they do not use.

## Validation

All listed checks passed. PostgreSQL checks use disposable local databases;
payment-provider calls are stubbed.

| Check | Result |
| --- | --- |
| API and web TypeScript checks | Passed |
| Production client and SSR build | Passed |
| Database migration upgrade, fresh install, and repeat scenarios | 69 checks passed |
| Article database integration | 29 checks passed |
| Article block normalization | 82 checks passed |
| Payment safety, including gateway switches | 24 scenarios passed |
| Order safety and concurrent payment behavior | 16 scenarios passed |
| Category purchase restrictions | 7 scenarios passed |
| Menu transactions, prices, permissions, and live updates | 9 scenarios passed |
| Courier scan idempotency, expiry, authorization, races, and map fallback | Passed |
| Product client behavior and dependent cache invalidation | Passed |
| Article client, editor, API client, and rendering suites | Passed |
| Printing protocol and browser lifecycle simulations | Passed |
| Tehran day boundaries and query identity | Passed |
| Checkout client, checkout intent, and financial cache synchronization | Passed |
| Patch whitespace check | Passed |

The production build and subprocess-based database tests needed execution
outside the Windows sandbox to spawn their helper processes.

Physical printers, a running QZ Tray installation, and the external map SDK
were not tested in a real browser. Direct printing now asks for QZ approval.
If the previous **Sinshin Web Print** certificate was trusted in QZ, remove its
trust entry: its old private key was public. Unattended printing would require
a separately configured server signer with a private deployment key.

Changes remain uncommitted in the working tree.
