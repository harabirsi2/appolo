# Provider terms — compliance checklist

The audit left this open: "check terms before enabling in production". This is
that check, per provider, with what the code does now and what is left.

**Not legal advice.** These are the clauses that bite a product like this one;
read the linked agreement yourself before the first paying customer, and
re-read it when a provider revises (TMDB and Apple both have).

Current providers (`lib/services/catalog-providers.ts`): `tmdb`, `itunes`,
`openlibrary`, `rawg`. `source` is `null`/`manual` for anything typed in by hand,
which carries no third-party obligation.

---

## TMDB — the strictest one, and mandatory

**Required:** the attribution sentence *"This product uses the TMDB API but is
not endorsed or certified by TMDB."* plus the TMDB mark, on every surface that
displays TMDB data.

| # | Clause | Status |
| --- | --- | --- |
| 1 | Attribution sentence + logo where data is shown | **Done** on item pages (`components/data-attribution.tsx`). **Not done** on search results and browse rails, which also render TMDB posters. |
| 2 | Do not imply endorsement | Done — the sentence says the opposite explicitly. |
| 3 | API key stays server-side | Done — `TMDB_API_KEY` is read in server code only; the CSP `connect-src 'self'` also blocks browser calls to it. |
| 4 | Cache lifetime / refresh obligation | **Unverified.** TMDB limits how long their data may be cached; the catalogue table has no TTL column. Decide: accept per-item re-hydration on read, or add a `hydrated_at` TTL sweep (half a day). |
| 5 | Images unmodified, no text overlaid | Done — we hotlink `image.tmdb.org` sizes as given and never composite. |
| 6 | No machine-learning training on their data | Done by omission: nothing here trains a model. Worth re-reading if ranking ever learns from metadata. |
| 7 | Commercial use allowed? | **Check the API terms section on commercial/commercial-free keys.** If TMDB requires a commercial key for revenue-generating use, that is a plan change, not a code change. |

**Action (1 hour):** add the credit line to the search results footer. That is
the only remaining *rendering* gap, and it is the one TMDB actually enforces.

---

## iTunes / Apple Search API

Notes for the Search API: rate limits are low (order of 20 calls/minute per IP),
the response is promotional metadata, and Apple requires credit without implying
endorsement.

| # | Clause | Status |
| --- | --- | --- |
| 1 | "Data provided by Apple" with a link | Done on item pages. Same search-page gap as TMDB. |
| 2 | No implied endorsement | Done — the note is neutral and links to apple.com. |
| 3 | Rate limit / no bulk scraping | Partly: enrichment is one lookup per item, no crawl. There is no client-side rate limiter or backoff in `catalog-providers.ts` — **add a 250 ms spacing + retry on 429** (an hour) before enabling in production at volume. |
| 4 | Artwork display rules | Done: hotlinked from Apple's CDN at the returned size, no modification. |
| 5 | Affiliate links | **Not applicable and deliberately so.** We link plain `itunes.apple.com` URLs; we are not in the affiliate program, so the affiliate disclosure and link-integrity rules do not apply. If affiliate IDs are ever added, they must be disclosed as affiliate links and never cloaked or injected over the user's click. |
| 6 | No caching beyond promotion | **Unverified.** Apple's guidelines discourage retaining metadata beyond promotional use; our catalogue keeps iTunes-derived rows indefinitely. Decide: a TTL for `source='itunes'` rows, or accept the risk at current volume. |

**Action (1 hour):** request spacing + 429 backoff. **Skip for now:** TTL sweep —
revisit with the TMDB caching decision, since it is the same mechanism.

---

## Open Library

| # | Clause | Status |
| --- | --- | --- |
| 1 | Bibliographic data is CC0 | Done — no licence obligation on the text itself. |
| 2 | Covers are **not** CC0 (publisher scans) | **Unverified.** We hotlink `covers.openlibrary.org`. Their stated practice permits this with attribution; if a cover is ever reported, remove the URL rather than argue. |
| 3 | Attribution requested | Done — "Bibliographic data from Open Library" with a link. |
| 4 | Rate limit / no scraping | Done: one search per user query, one hydration per item. |
| 5 | Identify the client (`User-Agent`) | **Not done** — requests use the default fetch UA. Their API etiquette asks for a contact UA; a one-line change, worth doing before production. |

**Action (15 minutes):** send `User-Agent: appolo/1.0 (+contact-url)`.

---

## RAWG (games)

| # | Clause | Status |
| --- | --- | --- |
| 1 | "Powered by RAWG" with a link | Done on item pages. |
| 2 | Free tier is non-commercial / attribution required | **Unverified.** Confirm the free API tier permits revenue-generating use; if not, games stay manual-entry until a paid plan. |

**Decision for now:** leave RAWG disabled in production (games can be added by
hand) until the commercial-use line is confirmed. That is cheaper than a plan
upgrade for a feature with no users yet.

---

## Cross-cutting

- **CSP + hotlinking**: images come from `image.tmdb.org`, `is1-ssl.mzstatic.com`,
  `covers.openlibrary.org`, `media.rawg.io`; the policy allows `img-src https:`,
  which is broad. Tightening to an allowlist is a hardening task, not a terms one.
- **No provider data in client bundles**: provider keys are server-only env vars,
  and `/api/catalog` proxies lookups. Verified by the CSP `connect-src 'self'`.
- **Deletion obligation**: if a provider asks for a dataset removal, the rows are
  keyed by `source` + provider id, so `delete from catalog_items where source='tmdb'`
  is the answer — but it takes the user's ratings with it via FK. The right
  sequence is: null the provider metadata, keep the user rows. Worth writing the
  SQL *before* anyone asks (an hour).

## Summary of remaining work

| Action | Time | Owner decision |
| --- | --- | --- |
| Credit line on search results (TMDB + Apple) | 1 h | Do before production |
| TMDB/iTunes cache TTL decision + sweep | 4 h | Defer until catalogue is large |
| iTunes request spacing + 429 backoff | 1 h | Do before enabling at volume |
| Open Library `User-Agent` | 15 min | Do before production |
| RAWG commercial-use check | 15 min (reading) | Keep disabled until confirmed |
| Provider-data removal SQL | 1 h | Write once, before it is needed |
