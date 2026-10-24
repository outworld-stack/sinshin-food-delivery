# Article directions in the separate Neshan app

The article's embedded map and the external Neshan app are separate integrations.
The embedded map already receives the article coordinates. Opening the native app
requires a link that the native app understands; a working website routing path
does not establish native-app support.

## Link contract

[Neshan's official FAQ](https://platform.neshan.org/FAQ/) documents these Android/web links:

- Point: `https://nshn.ir/?lat=LAT&lng=LNG`
- Route: `https://nshn.ir?origin=LAT,LNG&destination=LAT,LNG&vehicle=d`

On 2026-10-24, HTTP checks confirmed that the point link redirects to
`https://neshan.org/maps/share/LAT,LNG`, preserving the selected point, and the
route link preserves both endpoints. A query with only `destination` and
`vehicle` redirects to the bare map and loses the destination. Adding `zoom`
to the point link does not change its redirect.

The article button now requests a fresh browser position, with high accuracy,
no cached-position allowance, and a ten-second GPS timeout. A separate
twelve-second deadline handles providers or unanswered permission prompts that
never call back. When the position is available, it supplies the route origin.
When unavailable, denied, invalid, or timed out, the button uses the documented
point link to open the article destination. The user can then request directions
inside Neshan. It no longer sends the website-only routing path on that fallback.

Duplicate clicks and late callbacks cannot trigger another navigation. Destination
changes and unmounting cancel the deadline and invalidate the pending request.
Invalid destination coordinates cannot launch directions.

## Native-app limits

The requested live-location/Gilan behavior is for the separate Neshan app.
Neshan's documented links expose neither live-tracking controls nor a regional
fallback viewport. The browser cannot enable the device's location setting or
grant Neshan's own location permission. Browser and native-app permissions are
independent, and a position passed in a route URL is a snapshot.

Consequently, the PWA cannot guarantee live tracking or a Gilan-wide view inside
Neshan when GPS is disabled. The fallback preserves the real destination; Gilan
is not substituted as an invented origin or replacement destination. Implementing
the requested viewport inside the native app needs support from Neshan's link/API
contract or the app itself. It is not implemented by this change.

## Verification

The automated article tests exercise fresh GPS, permission denial, unavailable
GPS, timeouts, missing geolocation, invalid coordinates, the independent deadline,
retries, duplicate callbacks, destination changes and cleanup. Map regressions
also cover the unchanged embedded article map.

Native behavior still needs verification on affected Android devices: open an
article with known coordinates and tap directions with GPS allowed, denied, and
disabled; verify the actual destination in Neshan, then repeat without Neshan
installed to check the web fallback. Test from both Chrome and the installed PWA.
HTTP redirects and mocked browser tests do not replace this device check.
