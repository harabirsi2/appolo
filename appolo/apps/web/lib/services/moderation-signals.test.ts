import assert from "node:assert/strict";
import test from "node:test";
import {
  DUPLICATE_THRESHOLD,
  autoHideEnabled,
  extractLinks,
  findDuplicate,
  normalizeReviewText,
  reviewSimilarity,
  scoreLinkSpam,
  triage,
} from "./moderation-signals";

const CLEAN =
  "The Bends sounds like a band learning to be quiet on purpose. Street Spirit still stops me cold every single time.";
const DUPLICATE_OF_CLEAN =
  "The Bends sounds like a band learning to be quiet on purpose! Street Spirit still stops me cold, every single time.";

test("a clean review produces no spam score", () => {
  const signal = scoreLinkSpam(CLEAN);
  assert.equal(signal.score, 0);
  assert.deepEqual(signal.reasons, []);
});

test("empty bodies are not spam, just empty", () => {
  assert.deepEqual(scoreLinkSpam(null), { score: 0, reasons: [] });
  assert.deepEqual(scoreLinkSpam("   "), { score: 0, reasons: [] });
});

test("links score, and a single link stays below the flag threshold", () => {
  const signal = scoreLinkSpam("good album, more at https://example.com/notes");
  assert.equal(signal.score, 12);
  assert.match(signal.reasons.join(" "), /1 link/);
  assert.ok(signal.score < 40);
});

test("link shorteners are penalised harder than plain links", () => {
  const plain = scoreLinkSpam("see https://example.com/review");
  const shortened = scoreLinkSpam("see https://bit.ly/xyz");
  assert.ok(shortened.score > plain.score);
  assert.match(shortened.reasons.join(" "), /link shortener/);
});

test("an advert with a shortener and an invite is near the top of the scale", () => {
  const signal = scoreLinkSpam(
    "Follow back for free followers! Telegram me at https://bit.ly/x and check my bio",
  );
  // Link + shortener + invite + follow-farming: enough to be reviewed first,
  // deliberately not enough to hide on its own (auto-hide needs >= 70).
  assert.ok(signal.score >= 60, `expected >= 60, got ${signal.score}`);
  assert.equal(triage({ body: "Follow back! Telegram me at https://bit.ly/x" }).action, "flag");
});

test("score is capped at 100 no matter how bad the body is", () => {
  const signal = scoreLinkSpam(
    "https://a.com https://b.com https://c.com https://d.com https://e.com https://bit.ly/y " +
      "crypto casino betting telegram whatsapp buy now discount code free followers dm me link in bio",
  );
  assert.equal(signal.score, 100);
});

test("extractLinks returns bare hosts, deduplicated by the caller", () => {
  assert.deepEqual(extractLinks("a https://www.Example.com/x. b bit.ly/abc c"), [
    "example.com",
    "bit.ly",
  ]);
});

test("normalisation ignores punctuation and case", () => {
  assert.equal(normalizeReviewText("Same   TEXT, twice!"), "same text twice");
});

test("a reworded copy is a duplicate, a different review is not", () => {
  assert.ok(reviewSimilarity(CLEAN, DUPLICATE_OF_CLEAN) >= DUPLICATE_THRESHOLD);
  const other = "An entirely different record about winter, trains and a very long bridge at night.";
  assert.ok(reviewSimilarity(CLEAN, other) < 0.4);
});

test("findDuplicate picks the closest candidate", () => {
  const match = findDuplicate(CLEAN, [
    { id: "far", body: "Something completely unrelated about a bridge and a winter train at night." },
    { id: "close", body: DUPLICATE_OF_CLEAN },
  ]);
  assert.equal(match?.id, "close");
  assert.ok((match?.similarity ?? 0) >= DUPLICATE_THRESHOLD);
});

test("short generic bodies are never duplicates", () => {
  assert.equal(findDuplicate("great album", [{ id: "other", body: "great album" }]), null);
  assert.equal(findDuplicate(CLEAN, [{ id: "short", body: "great album" }]), null);
});

test("triage flags duplicates but only hides them when auto-hide is enabled", () => {
  const input = { body: CLEAN, candidates: [{ id: "original", body: DUPLICATE_OF_CLEAN }] };
  const flagged = triage(input);
  assert.equal(flagged.action, "flag");
  assert.match(flagged.reason, /Duplicate of review original/);

  const hidden = triage({ ...input, autoHideEnabled: true });
  assert.equal(hidden.action, "hide");
});

test("triage flags mid-range spam and hides only unambiguous spam when enabled", () => {
  const mild = triage({
    body: "nice, see https://example.com and https://example.org and https://example.net for more",
  });
  assert.equal(mild.action, "flag");

  const blatant = "free followers telegram whatsapp https://bit.ly/x buy now discount code";
  assert.equal(triage({ body: blatant }).action, "flag");
  assert.equal(triage({ body: blatant, autoHideEnabled: true }).action, "hide");
});

test("clean content is left alone", () => {
  const decision = triage({ body: CLEAN });
  assert.equal(decision.action, "none");
  assert.equal(decision.duplicate, null);
});

test("auto-hide is opt-in through the environment", () => {
  const previous = process.env.MODERATION_AUTO_HIDE;
  process.env.MODERATION_AUTO_HIDE = "1";
  assert.equal(autoHideEnabled(), true);
  process.env.MODERATION_AUTO_HIDE = "true";
  assert.equal(autoHideEnabled(), false);
  if (previous === undefined) delete process.env.MODERATION_AUTO_HIDE;
  else process.env.MODERATION_AUTO_HIDE = previous;
});
