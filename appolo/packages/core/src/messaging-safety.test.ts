import assert from "node:assert/strict";
import test from "node:test";
import { escapeCsvCell } from "./csv.ts";
import {
  messageStatusesBelow,
  shouldApplyMessageStatus,
  type MessageDeliveryStatus,
} from "./messaging.ts";

/* ------------------------------------------------------------------ */
/* CSV injection                                                       */
/* ------------------------------------------------------------------ */

test("formula-looking cells are neutralized on export", () => {
  assert.equal(escapeCsvCell("=1+1"), "'=1+1");
  assert.equal(escapeCsvCell("=cmd|' /C calc'!A0"), "'=cmd|' /C calc'!A0");
  assert.equal(escapeCsvCell("@SUM(A1:A9)"), "'@SUM(A1:A9)");
  assert.equal(escapeCsvCell("-2+cmd|' /C calc'!A0"), "'-2+cmd|' /C calc'!A0");
  assert.equal(escapeCsvCell("\t=1+1"), "'\t=1+1");
});

test("plain numbers and phone numbers are not mangled", () => {
  assert.equal(escapeCsvCell("+15551234567"), "+15551234567");
  assert.equal(escapeCsvCell("-5"), "-5");
  assert.equal(escapeCsvCell("9.5"), "9.5");
  assert.equal(escapeCsvCell("+1 (555) 123-4567"), "+1 (555) 123-4567");
});

test("RFC 4180 quoting still applies to commas, quotes and newlines", () => {
  assert.equal(escapeCsvCell('a,b'), '"a,b"');
  assert.equal(escapeCsvCell('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(escapeCsvCell(null), "");
  assert.equal(escapeCsvCell("normal"), "normal");
});

/* ------------------------------------------------------------------ */
/* delivery-status ordering                                            */
/* ------------------------------------------------------------------ */

test("a replayed or regressing status is not applied", () => {
  assert.equal(shouldApplyMessageStatus("delivered", "sent"), false);
  assert.equal(shouldApplyMessageStatus("delivered", "queued"), false);
  assert.equal(shouldApplyMessageStatus("sent", "queued"), false);
  // Identical status is a no-op, so a replay cannot insert a duplicate event.
  assert.equal(shouldApplyMessageStatus("delivered", "delivered"), false);
});

test("a forward status advance is applied", () => {
  assert.equal(shouldApplyMessageStatus("queued", "sent"), true);
  assert.equal(shouldApplyMessageStatus("queued", "delivered"), true);
  assert.equal(shouldApplyMessageStatus("sent", "delivered"), true);
  assert.equal(shouldApplyMessageStatus(null, "sent"), true);
  assert.equal(shouldApplyMessageStatus(undefined, "delivered"), true);
});

test("messageStatusesBelow lists exactly the statuses a callback may replace", () => {
  assert.deepEqual(messageStatusesBelow("queued"), []);
  assert.deepEqual(messageStatusesBelow("sent"), ["queued"]);
  assert.deepEqual(
    messageStatusesBelow("delivered").slice().sort(),
    (["queued", "sent", "received"] as MessageDeliveryStatus[]).sort(),
  );
  // `failed` shares `delivered`'s rank, so neither can replace the other and
  // neither can be replaced by a lower status.
  assert.deepEqual(messageStatusesBelow("failed").sort(), ["queued", "sent", "received"].sort());
});
