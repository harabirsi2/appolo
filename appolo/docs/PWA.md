# PWA: making the web app feel native

Podiums is a native iOS app. We are not shipping a second native client: the
milestone plan is **PWA-first**. A solo developer maintaining one codebase beats
two, install-to-home-screen removes the address bar, and every feature below
exists on iOS Safari 16.4+ when the app is installed. The two things we give up
are App Store distribution and background execution beyond push — both are
acceptable for a ranking app that only needs a notification to bring someone
back.

This is milestone 1: installable, offline-capable for the duel, push delivery,
and the iOS layout fixes.

## 1. The manifest

`apps/web/app/manifest.ts` (served at `/manifest.webmanifest`), rendered:

```json
{
  "id": "/",
  "name": "Appolo — compare, don't score",
  "short_name": "Appolo",
  "description": "Rank what you love by picking the better of two titles. Movies, TV, music, podcasts, books and games, one tap at a time.",
  "start_url": "/app?source=pwa",
  "scope": "/",
  "display": "standalone",
  "display_override": ["standalone", "minimal-ui"],
  "orientation": "portrait",
  "background_color": "#07080A",
  "theme_color": "#07080A",
  "lang": "en",
  "dir": "ltr",
  "categories": ["entertainment", "lifestyle"],
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "Rate something", "short_name": "Rate", "description": "Start a head-to-head comparison", "url": "/app/rate", "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" }] },
    { "name": "Search the catalog", "short_name": "Search", "description": "Find a title to rank", "url": "/app/search", "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" }] }
  ]
}
```

Decisions worth keeping:

- **`start_url` carries `?source=pwa`** so installs can be told apart from
  browser visits without a separate analytics SDK.
- **Two-colour set, one colour decision.** `theme_color` and `background_color`
  are both `#07080A` (the app's `--color-bg`), so the launch splash is the same
  black as the shell. A white splash followed by a black app is the cheapest way
  to make an installed app feel fake.
- **`maskable` is a separate file**, not the same icon with a flag: the mark is
  inset to an 80% safe zone so Android can crop it to a circle without clipping
  a bar.
- **Shortcuts point at routes that exist** (`/app/rate`, `/app/search`). A
  shortcut to a 404 is worse than no shortcut.

Icons are generated, not hand-exported. `scripts/gen-icons.mjs` draws the mark
as SVG and rasterises the four sizes with sharp (already a dependency of
`@appolo/db`, resolved from there):

```bash
node scripts/gen-icons.mjs   # writes apps/web/public/icons/*.png
```

## 2. Service worker: what is cached and for how long

`apps/web/public/sw.js`. No build step, no workbox, ~330 lines you can read in
one sitting. Registered from `components/pwa-register.tsx`.

| Resource | Strategy | Freshness / cap | Why |
| --- | --- | --- | --- |
| Navigations (`mode: navigate`) | network-first, 4 s timeout → `/offline` from precache | none (always live) | A cached HTML shell that never updates pins users to an old build. 4 s is the point where waiting feels broken. |
| `/offline`, `/icons/*`, `/manifest.webmanifest` | precache at install | until the next install | The fallback page must exist before the network does. |
| `/_next/static/*` | cache-first | immutable, cleared on version bump | Content-hashed filenames: the content can never change under a name. |
| Cover art (`/_next/image`, `/covers/*`, `/cache/covers/*`) | stale-while-revalidate | 30 days at the HTTP layer, 240 entries in the cache | Art is what makes the duel feel instant. Serve the pixels you have, refresh behind the user. |
| `GET /api/catalog`, `GET /api/health` | network-first, 5 s timeout → cache | ~ incidental | Only these two are account-independent, so only these may be cached. |
| Every other `/api/*` | network-only (passes through) | never cached | These are per-account responses; the Cache API ignores cookies, so caching one would show the previous user's feed on a shared device. |
| `POST /api/rankings/:id/vote` | network, then **durable queue** on failure | unbounded until flushed | See below. |
| Push (`push`, `notificationclick`) | n/a | n/a | Shows the notification and focuses or opens the URL it carries. |

The cache version (`appolo-v1`) is part of every cache name, so `activate`
deletes all older caches in one pass. Bump `VERSION` when the strategies change.

`sw.js` is served with `Cache-Control: no-store` (`next.config.ts`) — a cached
worker is a device frozen on an old strategy until the HTTP cache expires.

**CSP note:** the middleware's `script-src` includes `'self'`, which the
`worker-src` fallback chain uses; service worker registration works today. If
`script-src` is ever tightened to nonce-only, add `worker-src 'self'` to the
policy or registration will be blocked.

## 3. Offline votes: idempotency against an append-only log

The invariant is that **`item_matchups` is the append-only source of truth** for
every comparison. A queue that can deliver the same vote twice would break it,
and undo would then delete the wrong row.

### Design

1. **Key at the moment of the tap.** `finish-rating.tsx` generates
   `crypto.randomUUID()` per vote and sends it as the `Idempotency-Key` header.
   Per tap, not per session: two different comparisons must both apply.
2. **Queue on the device.** If the POST fails at the network layer, the worker
   stores `{ key, url, body, createdAt }` in IndexedDB (`appolo-outbox`) and
   answers the page with `202 { queued: true }`. The UI says "Saved on this
   device — this comparison syncs when you are back online", keeps the same duel
   on screen, and does not claim the score moved.
3. **Flush in order.** On `sync` (Chromium) or an `online` message from
   `pwa-register.tsx` (iOS has no Background Sync), the worker replays each
   entry with its original key. Network errors stop the loop and keep the queue;
   a 4xx drops that entry so a vote for a deleted item cannot retry forever.
4. **Commit marker.** `submitVote` runs the whole vote in one `withOrg`
   transaction and writes a `vote_receipts` row — primary key
   `(org_id, idempotency_key)`, plus the response it returned — as the last
   statement. A duplicate delivery hits the primary key, the insert fails, the
   transaction rolls back, and **none** of the Elo updates, counters,
   `rating_events` row or `item_matchups` row survive. The handler then reads the
   stored receipt and replays the original response with `replayed: true` and an
   `x-idempotent-replay: 1` response header.
5. **Why not a key on `rating_events`?** That table only has a row for counted
   votes. Skips and undecideds write no event but still move `matches`/`skips`,
   so keying on the event row would leave two of the five outcomes unprotected —
   exactly the outcomes a queue retries. The receipt table is outcome-agnostic
   and doubles as a debugging log.
6. **Concurrency.** If two deliveries race, the loser gets `23505`, re-reads the
   receipt and answers with it. The winner's transaction is the only one that
   commits.

The append-only log therefore keeps exactly one row per real comparison, and
`undoLastComparison` keeps working: it deletes the matchup `event_id` the vote
created.

A vote without a key still works — the key is a retry optimisation, not a
contract. Malformed keys (`< 8` or `> 120` chars) are dropped rather than
rejected.

## 4. Push

**Storage** (`0027_pwa_offline_push.sql`): `push_subscriptions` — one row per
device endpoint (unique), RLS-scoped by `org_id`, with `enabled`,
`failure_count`, `last_success_at`. Re-subscribing on the same browser moves the
row to the account that is signed in now, so the previous person stops receiving.

**API**: `GET/POST/DELETE /api/push/subscribe`.
`GET` returns the VAPID public key (the browser needs it to subscribe), `POST`
stores `{endpoint, keys:{p256dh, auth}}`, `DELETE` removes by endpoint.

**Send path** (`apps/worker/src/push.ts`, `web-push` as the worker's one new
dependency — VAPID signing + RFC 8291 payload encryption is not something to
hand-roll): BullMQ jobs on the existing `system` queue.

- `push-friend-activity`, every 5 minutes, window 6 minutes. Derives "friends
  rated X" from `item_matchups` joined to `follows` — nothing is written on the
  vote path, and a missed push cannot corrupt history. One notification per
  follower per window (three friends voting is one moment, not three buzzes).
- `push-weekly-digest`, Mondays 09:00, 7-day window, only accounts with ≥5
  comparisons.

The worker disables a subscription immediately on `404`/`410` (browser revoked
it) and after 5 consecutive failures. Delivery failures never throw into the
queue. Without `PUSH_VAPID_*` both jobs no-op and log — subscriptions are still
stored, so turning keys on starts delivery on the next tick.

**Permission UX** (`components/push-opt-in.tsx`), shown on the post-first-rating
screen and nowhere else:

> **Know when your friends rank something**
> One notification when someone you follow finishes a comparison, plus a short
> weekly recap. No daily pings, no marketing, off in one tap.
> [Turn on notifications] [Not now]

Rules, because a browser denial is permanent and cannot be re-prompted:

1. Ask only after demonstrated value (a saved rating), never on arrival.
2. State the frequency and the content before the OS dialog appears.
3. "Not now" snoozes 14 days instead of re-asking on the next visit.
4. On iOS without the Home Screen install, show the Share → Add to Home Screen
   instruction instead of calling `requestPermission()` (Safari does not expose
   notifications to browser tabs, and the prompt would fail permanently).
5. Never ask again when permission is already `denied`.

## 5. iOS-specific fixes

| Problem | Fix | Where |
| --- | --- | --- |
| Content under the notch / home indicator | `viewportFit: "cover"` + `env(safe-area-inset-*)` utilities (`safe-bottom`, `safe-top`, `safe-x`) | `app/layout.tsx`, `globals.css`, `components/bottom-nav.tsx` |
| `100vh` taller than the visible screen while the URL bar is out | `min-height: 100dvh` with a `100vh` fallback | `globals.css`, `app/offline/page.tsx` |
| Focusing a form zooms the page and never zooms back | `font-size: max(16px, 1em)` on inputs inside `@supports (-webkit-touch-callout: none)` | `globals.css` |
| Rubber-band scroll reveals white behind a black app | `overscroll-behavior-y: contain` under `@media (display-mode: standalone)` | `globals.css` |
| Launch flash of white | `background_color`/`theme_color` `#07080A`, `black-translucent` status bar | `manifest.ts`, `layout.tsx` |
| Home-screen icon missing | `apple-touch-icon` 180px, opaque | `layout.tsx` metadata |

Standalone detection in the app is
`matchMedia("(display-mode: standalone)").matches || navigator.standalone`, used
today by the push card to decide between the iOS install hint and the ask.

## 6. Performance budget

Targets (Lighthouse mobile, throttled, on the installed app and the landing page):

| Metric | Budget | What it constrains |
| --- | --- | --- |
| LCP | < 2.5 s | hero cover art + fonts |
| INP | < 200 ms | duel tap → next pair |
| CLS | < 0.1 | cover images without reserved space |
| Total JS (initial) | < 180 kB gzip | client bundles |
| Cover transfer per screen | < 250 kB | AVIF + right-sized variants |

Configs that serve the budget (`apps/web/next.config.ts`, `app/fonts.ts`):

- **Fonts**: three committed `.woff2` files loaded with `next/font/local` —
  self-hosted, latin-only, `display: swap`, no network fetch at build. The emoji
  face is a pyftsubset of Noto Color Emoji covering only the 16 glyphs the UI
  uses, and it is `preload: false` so it never competes with Inter for the first
  paint.
- **Images**: `formats: ["image/avif", "image/webp"]` and a `deviceSizes` ladder
  starting at 96 px so a 44 px thumbnail never downloads a 720 px file.
  `minimumCacheTTL` 30 days keeps the optimizer off repeat visits. Every cover
  goes through `MediaArt` with an explicit `sizes` value.
- **Caching**: covers are stale-while-revalidate in the service worker, so a
  repeat duel paints from disk with no network wait (the biggest INP win).
- **Data**: pages are server components that read Postgres directly. Mutations
  are route handlers (the client needs the JSON response for optimistic UI);
  where a mutation returns nothing the form should use a server action instead
  of a round trip plus `router.refresh()`.

### Measuring

```bash
pnpm build && pnpm --filter @appolo/web start
npx lighthouse http://localhost:3000 --preset=desktop --form-factor=mobile \
  --throttling.throughputKbps=1600 --view
```

Run it three times and take the median: a single run on a shared VM is noise.
CLS is the one metric worth checking by hand as well (DevTools → Performance →
Experience), because the duel swaps two large images in place.

## 7. Configuration

```bash
npx web-push generate-vapid-keys
# .env
PUSH_VAPID_PUBLIC_KEY=...
PUSH_VAPID_PRIVATE_KEY=...
PUSH_VAPID_SUBJECT=mailto:hello@appolo.app
```

Rotating VAPID keys invalidates every existing subscription: all devices must
re-subscribe, so rotate only with a re-ask plan.

## 8. What is not done

- No `screenshots` in the manifest yet (rich install UI on Android); needs two
  real captures at 1080×1920.
- No offline reading of the ranking list: only the duel queues votes, by design.
- Push targeting is derived from `item_matchups` every 5 minutes; a real event
  log would let us push instantly and dedupe exactly.
- iOS Background Sync does not exist, so a vote queued while the app is closed
  flushes when it is next opened.
- Lighthouse has not been run on a real device in this workspace (no Chromium
  system libraries, no root); the numbers above are the budget, not measurements.
