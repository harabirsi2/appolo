import assert from "node:assert/strict";
import test from "node:test";
import { bayesianScore, eloForScore, scoreForElo, scoreStepBounds } from "./ranking.ts";
import { createItunesAdapter, createOpenLibraryAdapter, createRawgAdapter, createTmdbAdapter } from "./metadata/index.ts";
import { isSearchCategory, mediaKindForCategory } from "./metadata/types.ts";
import { tmdbInternals } from "./metadata/tmdb.ts";

test("the decimal scale has no dead zones", () => {
  const seen = new Set<number>();
  for (let elo = 1200; elo <= 1800; elo += 1) {
    const score = scoreForElo(elo);
    assert.ok(score >= 0 && score <= 10);
    seen.add(score);
  }
  // Every tenth from 0.0 to 10.0 is reachable.
  assert.equal(seen.size, 101);
  for (let tenth = 0; tenth <= 100; tenth += 1) {
    assert.equal(scoreForElo(eloForScore(tenth / 10)), tenth / 10);
  }
  const bounds = scoreStepBounds(6.8);
  assert.ok(bounds.lowerElo < bounds.upperElo);
});

test("Bayesian score shrinks small samples toward the category mean", () => {
  const cold = bayesianScore({ count: 1, mean: 10, categoryMean: 6 });
  assert.equal(cold, 6.7);
  const warm = bayesianScore({ count: 100, mean: 10, categoryMean: 6 });
  assert.ok(warm > 9.5 && warm < 10);
  assert.equal(bayesianScore({ count: 0, mean: 10, categoryMean: 6.4 }), 6.4);
});

test("TMDB detects anime from Japanese origin and animation genre", () => {
  assert.equal(tmdbInternals.isAnimeRow({ origin_country: ["JP"], genre_ids: [16, 18] }), true);
  assert.equal(tmdbInternals.isAnimeRow({ origin_country: ["US"], genre_ids: [16] }), false);
  assert.equal(tmdbInternals.isAnimeRow({ origin_country: ["JP"], genre_ids: [18] }), false);
});

test("TMDB candidates store provider ids and absolute artwork URLs", () => {
  const candidate = tmdbInternals.candidateFor("movie", "movie", {
    id: 603,
    title: "The Matrix",
    release_date: "1999-03-31",
    poster_path: "/poster.jpg",
    backdrop_path: "/backdrop.jpg",
    overview: "A hacker learns the truth.",
    genre_ids: [28, 878],
    vote_average: 8.2,
  });
  assert.ok(candidate);
  assert.equal(candidate.externalId, "603");
  assert.equal(candidate.externalRef, "tmdb:movie:603");
  assert.equal(candidate.source, "tmdb");
  assert.ok(candidate.coverUrl?.startsWith("https://image.tmdb.org/t/p/w500/"));
  assert.deepEqual(candidate.genres, ["Action", "Sci-Fi"]);
  assert.equal(candidate.year, 1999);
});

test("TMDB maps a season's episodes and skips specials", async () => {
  const urls: string[] = [];
  const adapter = createTmdbAdapter({
    tmdbApiKey: "test-key",
    fetchImpl: (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          episodes: [
            { season_number: 2, episode_number: 1, name: "Pilot", air_date: "2021-01-02", runtime: 48 },
            { season_number: 2, episode_number: 0, name: "Special" },
            { season_number: 2, episode_number: 2, name: "Second", air_date: null, runtime: null },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch,
  });

  const candidate = tmdbInternals.candidateFor("tv", "tv", {
    id: 1399,
    name: "Game of Thrones",
    first_air_date: "2011-04-17",
  });
  assert.ok(candidate);
  const episodes = await adapter.seasonEpisodes!(candidate, 2);

  assert.equal(episodes.length, 2, "episode 0 (specials) is not rateable");
  assert.deepEqual(episodes[0], {
    seasonNumber: 2,
    episodeNumber: 1,
    title: "Pilot",
    airDate: "2021-01-02",
    runtime: 48,
  });
  assert.equal(episodes[1]!.airDate, null, "a missing air date stays null");
  assert.ok(urls[0]!.includes("/tv/1399/season/2"), urls[0]);
  assert.ok(urls[0]!.includes("api_key=test-key"), "the key is sent as a query param");
});

test("TMDB season episodes stay offline without a key or for a non-TV item", async () => {
  let calls = 0;
  const adapter = createTmdbAdapter({
    tmdbApiKey: "test-key",
    fetchImpl: (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  const movie = tmdbInternals.candidateFor("movie", "movie", { id: 603, title: "The Matrix" });
  assert.ok(movie);
  assert.deepEqual(await adapter.seasonEpisodes!(movie, 1), []);

  const tv = tmdbInternals.candidateFor("tv", "tv", { id: 1399, name: "Game of Thrones" });
  assert.ok(tv);
  assert.deepEqual(await createTmdbAdapter({}).seasonEpisodes!(tv, 1), []);
  assert.equal(calls, 0, "no request is made when the item or the key cannot answer");
});

test("iTunes adapter maps 600px artwork and album ids", async () => {
  const adapter = createItunesAdapter({
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              collectionId: 1440857781,
              collectionName: "Blonde",
              artistName: "Frank Ocean",
              artworkUrl100: "https://is1.mzstatic.com/image/100x100bb.jpg",
              releaseDate: "2016-08-20",
              primaryGenreName: "R&B/Soul",
              trackCount: 17,
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch,
  });
  const results = await adapter.search("music", "blonde", 5);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.externalRef, "itunes:music:1440857781");
  assert.equal(results[0]!.coverUrl, "https://is1.mzstatic.com/image/600x600bb.jpg");
  assert.equal(results[0]!.subtitle, "Frank Ocean");
});

test("Open Library adapter maps covers and authors", async () => {
  const adapter = createOpenLibraryAdapter({
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          docs: [
            {
              key: "/works/OL123W",
              title: "Piranesi",
              author_name: ["Susanna Clarke"],
              first_publish_year: 2020,
              cover_i: 10521270,
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch,
  });
  const results = await adapter.search("book", "piranesi", 5);
  assert.equal(results[0]!.externalRef, "openlibrary:OL123W");
  assert.equal(results[0]!.subtitle, "Susanna Clarke");
  assert.equal(results[0]!.coverUrl, "https://covers.openlibrary.org/b/id/10521270-L.jpg");
});

test("RAWG stays disabled without a key", async () => {
  const adapter = createRawgAdapter({});
  assert.deepEqual(await adapter.search("game", "elden ring", 5), []);
});

test("search categories map anime onto the TV kind", () => {
  assert.equal(isSearchCategory("anime"), true);
  assert.equal(isSearchCategory("nope"), false);
  assert.equal(mediaKindForCategory("anime"), "tv");
  assert.equal(mediaKindForCategory("book"), "book");
});