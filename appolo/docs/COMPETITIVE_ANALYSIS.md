# Competitive analysis

Updated 2026-11-16. This is a product comparison, not a claim that Appolo has
feature parity. Sources are the public product pages and store listings linked
below; they were accessed on the update date.

## Market map

| Product | Scope | Core interaction | Social / discovery | Main strength |
|---|---|---|---|---|
| [Podiums](https://podiu.ms/) | Movies, TV, music, podcasts, books | Head-to-head comparison produces a personal score and top five | Follow people, browse profiles, collect/share "pods" | Ranking-first, cross-media taste profile |
| [Letterboxd](https://letterboxd.com/about/what-is-letterboxd) | Film | Five-star ratings, reviews, diary, lists | Follows, likes, lists, film community | Deep film logging and a large review network |
| [Goodreads](https://www.goodreads.com/) | Books | Star ratings, reviews, shelves | Follows, groups, author/publisher catalogue | Book catalogue and reading-community breadth |
| [Backloggd](https://backloggd.com/about) | Games | Played/playing/backlog logging, ratings, reviews, journals | Follows, friend activity, lists | Game collection and play-session tracking |
| [Serializd](https://www.serializd.com/about) | TV | Episode/season/series ratings, reviews, diary | Follows, discussions, member lists | TV-specific granularity and episode tracking |

Appolo is closest to **Podiums**: both replace a single "what number is this?"
rating with pairwise choices and a shareable taste identity. Appolo
differentiates by supporting six media kinds including games, exposing the
ranking model (Bradley–Terry + Davidson with ties and confidence intervals),
and offering transparent taste comparisons and explainable feed reasons.

## Where Appolo is differentiated

- **Cross-media ranking in one profile.** A user can build one taste graph
  across film, TV, music, podcasts, books and games, rather than maintaining
  separate identities in a film app and a book app.
- **Ranking quality is visible.** `item_matchups` is durable, ties are modelled,
  confidence is shown, and manual order is stored separately without fabricating
  comparisons. Most competitors present a star average with no uncertainty.
- **Explainable discovery.** The For-you feed exposes why a review surfaced
  (followed author, taste match, freshness, engagement) and supports a strict
  chronological Following feed.
- **Public social artifacts.** Profiles, pinned reviews, shareable pods, review
  pages, embeds and OG images make taste easy to share outside the app.
- **Import path.** Goodreads, Letterboxd and Spotify imports reduce the cold
  start compared with a new social graph with no history.

## Where established competitors are stronger

- **Catalogue and metadata depth.** Letterboxd, Goodreads, Backloggd and
  Serializd have years of title, edition, episode and creator data. Appolo's
  seeded catalogue is 1,181 titles, so breadth is the clearest product gap.
- **Logging workflows.** Letterboxd's diary, Backloggd's play sessions and
  Serializd's episode tracking are mature habits that Appolo does not yet model.
- **Native mobile distribution.** Podiums and Serializd ship native apps;
  Appolo is a responsive web/PWA. That affects retention and notification reach.
- **Network density.** The incumbents already have the friend graph and review
  volume that make discovery useful before a new user has rated anything.
- **Trust and safety / privacy.** Appolo now has reporting and a moderator
  queue, but block/mute, private accounts and private lists are not enforced
  across every query. The incumbents offer more mature account controls.

## Strategic position

Appolo should not compete as a broader Letterboxd or Goodreads. The defensible
position is **the ranking-first, cross-media taste graph**: fewer, better
comparisons; transparent confidence; a profile that works across media; and a
social layer built around taste rather than posting volume.

The near-term priorities that follow from this comparison are:

1. **Protect the ranking promise.** Improve catalogue breadth and import
   coverage, and keep the model explainable rather than hiding it behind a
   single score.
2. **Raise switching value.** Make taste comparison, pods and public profiles
   useful before a user has a large rating history.
3. **Close table-stakes gaps.** Block/mute, private accounts/lists, notification
   controls and mobile-friendly notifications matter for retention.
4. **Earn network effects.** Seed through importable history and shareable
   review/pod links rather than trying to outscale incumbent catalogues.

## Sources

- Podiums product site: <https://podiu.ms/>
- Podiums App Store listing: <https://apps.apple.com/us/app/podiums-ratings-and-rankings/id6738963615>
- Letterboxd: <https://letterboxd.com/about/what-is-letterboxd>
- Backloggd: <https://backloggd.com/about>
- Serializd: <https://www.serializd.com/about>
- Goodreads: <https://www.goodreads.com/>
