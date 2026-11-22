import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "./importers";

test("parses simple csv rows keyed by lowercased headers", () => {
  const rows = parseCsv("Name,Year\nAlien,1979\nArrival,2016");
  assert.deepEqual(rows, [
    { name: "Alien", year: "1979" },
    { name: "Arrival", year: "2016" },
  ]);
});

test("keeps commas inside quoted cells", () => {
  const rows = parseCsv('Title,Note\n"Requiem, for a Dream","two, commas"');
  assert.equal(rows[0]?.title, "Requiem, for a Dream");
  assert.equal(rows[0]?.note, "two, commas");
});

test("unescapes doubled quotes and handles crlf line endings", () => {
  const rows = parseCsv('Quote\r\n"He said ""hello"" there"\r\n');
  assert.equal(rows[0]?.quote, 'He said "hello" there');
});

test("drops blank lines and tolerates short rows", () => {
  const rows = parseCsv("A,B\none,two\n\n\nthree");
  assert.deepEqual(rows, [{ a: "one", b: "two" }, { a: "three", b: "" }]);
});
