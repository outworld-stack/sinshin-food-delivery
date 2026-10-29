# Neshan directions on About Us and article blocks

Both pages use `NeshanDirectionsButton`; `ArticleRouteButton` is an alias. The
embedded Neshan map is separate from opening the external website or native app.

## About content and location

The About editor supports uploaded images, optional team content, Persian and
Arabic content blocks, and a restaurant destination with localized address text.
The public page renders saved blocks in order and places directions below its map.
An empty Arabic document explicitly hides those blocks in Arabic; removing that
document restores the Persian fallback.

The admin endpoint returns original editable fields and keeps a nullable custom
`location` separate from `defaultLocation`, the configured restaurant location.
Unrelated saves preserve this default, and the editor can reset a custom location
to it. Public responses resolve the default and localize content and addresses.
Apply migration `0019_warm_lionheart.sql` before deploying the updated API; it adds
nullable JSONB columns without replacing existing About content.

## Chooser and saved preference

Clicking **Get Directions from My Location** opens a native modal dialog with
Neshan website/app choices and **Always** / **Just this once** actions. **Always**
stores the selected target in this browser and preselects it next time. **Just
this once** leaves an existing preference unchanged. The chooser includes a
control to clear the saved choice. Storage denial does not prevent directions.
Only `web` or `app` is stored; user coordinates are never persisted.

The prompt remains before every redirect, including when a choice is saved.
This also ensures that launching the app follows a fresh user gesture, which
mobile browsers require. A website cannot force Android's operating-system
resolver or change the user's Android default-app settings.

The native dialog uses the browser top layer (so article animations cannot clip
it), focus trapping and inert background. Closing explicitly restores focus to
the directions button after React removes the dialog. Escape, Cancel and backdrop
click close it. Text is available in Persian and Arabic.

Embedded maps load near the viewport, show a translated fallback if the map key
or SDK is unavailable, and keep the directions button usable. Failed maps release
their WebGL resources and can recover when their destination changes. The map
container stays mounted and sized during recovery so a cached SDK cannot race
React's rendering of the replacement destination.

## Position and routing

The chooser requests fresh high-accuracy browser GPS with `maximumAge: 0` and a
10-second geolocation timeout. An independent 12-second deadline handles stalled
providers or unanswered permission prompts. Launch actions wait for either GPS
or that fallback. GPS never triggers navigation itself: the user launches the
prepared route by pressing **Always** or **Just this once**.

If GPS is available, its origin and the destination are passed through. If it is
denied, unavailable, invalid, unsupported or times out, the real destination is
preserved and the chooser explains that the starting point can be selected in
Neshan. Duplicate clicks/callbacks, closing the dialog, changing destinations and
unmounting cannot trigger stale navigation. Invalid destination coordinates
disable directions.

## Link contract

[Neshan's official FAQ](https://platform.neshan.org/FAQ/) was checked on
2026-10-29. It documents:

- Android/web point: `https://nshn.ir/?lat=LAT&lng=LNG`
- Android/web route:
  `https://nshn.ir?origin=LAT,LNG&destination=LAT,LNG&vehicle=d`
- iOS point: `neshan://?ll=LAT,LNG`
- iOS route: `neshan://?origin=LAT,LNG&destination=LAT,LNG&vehicle=d`

The **website** choice uses the existing Neshan website routing paths directly,
including `origin/LAT,LNG` when available and `destination/LAT,LNG` in all cases.
It does not pass through the app-link domain.

The **Android app** choice wraps the documented HTTPS link in an Android intent
targeting `org.rajman.neshan.traffic.tehran.navigator`, the package linked from
[Neshan's official homepage](https://neshan.org/) to Google Play and Bazaar. The
intent includes an encoded `browser_fallback_url` containing the complete website
route; supporting browsers open that fallback when the app is not installed.
Origin-less app navigation uses the documented point link, because an nshn.ir
query with only `destination` loses the destination on its web redirect.

The **iOS app** choice uses the documented `neshan://` route/point scheme. The
dialog retains a direct website fallback after an app launch attempt, including
for browsers that cannot handle Android intents. No timer guesses whether the
app is installed or unexpectedly redirects when the user returns from it. Other
platforms use the documented HTTPS smart link for the app choice.

## Verification and native-app limits

Automated article tests cover chooser selection, persisted/default/one-off/reset
behavior, corrupted or blocked storage, explicit web routes, Android intent and
web fallback coordinates, iOS schemes, user-gesture-only launch, GPS errors and
deadlines, retries, stale callbacks, cancellation, destination changes and cleanup.
The article rendering and map tests cover lazy loading, failure messages, stalled
loads, recovery after destination changes, translated labels and resource cleanup.

Actual native launch and Neshan's start-navigation button require device testing:

1. In Android Chrome and the installed PWA, choose the app with Neshan installed;
   verify the destination and fresh GPS origin, then tap Neshan's start button.
2. Repeat with Neshan absent and verify the website fallback retains both points.
3. Repeat on iOS Safari with Neshan installed/absent; use the visible website
   fallback if the scheme is unavailable.
4. Repeat with GPS allowed, denied and disabled, and test Always/once/reset across
   About Us and an article location block.

Browser and native-app location permissions are independent. These links supply
route coordinates; Neshan controls its own live tracking, permissions, route
preview and start-navigation UI. Automated URL checks cannot verify those device
behaviors or guarantee a particular native button label.
