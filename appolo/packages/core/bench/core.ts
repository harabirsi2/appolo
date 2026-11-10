/**
 * Hot-path benchmark for the pure TypeScript ranking core.
 *
 * Run with `pnpm --filter @appolo/core bench`. Numbers are wall-clock medians
 * on the machine running the benchmark, so treat them as a local baseline to
 * compare changes against, not as capacity planning for production.
 */
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import { rankFeed, type FeedInput } from "../src/feed-rank.ts";
import { fitBradleyTerry, type ComparisonEvent } from "../src/ranking-model.ts";
import { genreProfile, tasteMatch, type SharedScore } from "../src/taste-match.ts";

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const random = rng(42);
const GENRES = ["drama", "comedy", "sci-fi", "horror", "documentary", "thriller", "romance", "animation"];

function makeFeedItems(count: number): FeedInput[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => ({
    id: `review-${index}`,
    authorId: `author-${index % 400}`,
    createdAt: new Date(now - Math.floor(random() * 30 * 86_400_000)),
    score: 1 + random() * 9,
    genres: Array.from(
      { length: 1 + Math.floor(random() * 3) },
      () => GENRES[Math.floor(random() * GENRES.length)]!,
    ),
    followed: index % 37 === 0,
    reactions: Math.floor(random() * 80),
    comments: Math.floor(random() * 30),
  }));
}

function makeEvents(itemCount: number, eventCount: number): ComparisonEvent[] {
  const outcomes = ["a", "b", "a", "b", "tie", "undecided"] as const;
  return Array.from({ length: eventCount }, () => ({
    aId: `item-${Math.floor(random() * itemCount)}`,
    bId: `item-${Math.floor(random() * itemCount)}`,
    outcome: outcomes[Math.floor(random() * outcomes.length)]!,
  }));
}

function makeShared(count: number): SharedScore[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    mine: Math.round(random() * 100) / 10,
    theirs: Math.round(random() * 100) / 10,
  }));
}

function percentile(samples: number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

function measure(label: string, runs: number, fn: () => unknown): string {
  for (let index = 0; index < Math.max(3, Math.floor(runs / 10)); index += 1) fn();
  const samples: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  const median = percentile(samples, 0.5);
  return `${label.padEnd(40)} median ${median.toFixed(2).padStart(8)} ms   p95 ${percentile(
    samples,
    0.95,
  )
    .toFixed(2)
    .padStart(8)} ms`;
}

const feed2k = makeFeedItems(2000);
const feed20k = makeFeedItems(20000);
const feedContext = {
  followedAuthorIds: Array.from({ length: 40 }, (_, index) => `author-${index * 3}`),
  genreWeights: { drama: 5, "sci-fi": 3, comedy: 2 },
};

const shared200 = makeShared(200);
const shared1000 = makeShared(1000);
const profileMine = genreProfile(
  Array.from({ length: 400 }, () => ({ genres: [GENRES[Math.floor(random() * GENRES.length)]!] })),
);
const profileTheirs = genreProfile(
  Array.from({ length: 400 }, () => ({ genres: [GENRES[Math.floor(random() * GENRES.length)]!] })),
);

console.log(
  `node ${process.version} · ${process.arch} · ${cpus().length} vCPU · ${new Date().toISOString()}`,
);
console.log("");
console.log(measure("rankFeed 2,000 items", 100, () => rankFeed(feed2k, feedContext)));
console.log(measure("rankFeed 20,000 items", 20, () => rankFeed(feed20k, feedContext)));
console.log(measure("tasteMatch 200 shared + profiles", 1000, () =>
  tasteMatch({ shared: shared200, mineProfile: profileMine, theirsProfile: profileTheirs }),
));
console.log(measure("tasteMatch 1,000 shared", 200, () => tasteMatch({ shared: shared1000 })));
console.log(measure("fitBradleyTerry 100 items / 2,000 events", 15, () =>
  fitBradleyTerry(makeEvents(100, 2000)),
));
console.log(measure("fitBradleyTerry 260 items / 5,200 events", 8, () =>
  fitBradleyTerry(makeEvents(260, 5200)),
));
console.log("");
console.log("Fit scaling (single pass, default solver settings):");
for (const items of [100, 300, 500]) {
  const events = makeEvents(items, items * 20);
  const start = performance.now();
  const fit = fitBradleyTerry(events);
  console.log(
    `  ${String(items).padStart(4)} items / ${String(events.length).padStart(6)} events   ${(
      performance.now() - start
    )
      .toFixed(1)
      .padStart(8)} ms   ${fit.iterations} iterations · converged ${fit.converged}`,
  );
}
