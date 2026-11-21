import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import test from "node:test";
import { hashPassword, passwordProblem, verifyPassword } from "./password";

test("new hashes use the OWASP scrypt cost and are stored with their parameters", async () => {
  const stored = await hashPassword("correct-horse-battery");
  const [scheme, n, r, p] = stored.split("$");
  assert.equal(scheme, "scrypt");
  assert.equal(Number(n), 2 ** 17, "N must be at least 2^17");
  assert.equal(Number(r), 8);
  assert.equal(Number(p), 1);

  assert.equal(await verifyPassword("correct-horse-battery", stored), true);
  assert.equal(await verifyPassword("wrong-horse-battery", stored), false);
});

/**
 * The cost bump must not lock anyone out. A hash written by the old code
 * (N=2^14) has to keep verifying, and the parameters come from the hash, not
 * from the current constants.
 */
test("hashes written with the old cost still verify", async () => {
  const salt = Buffer.from("0123456789abcdef");
  const legacy = scryptSync("legacy-password-1", salt, 64, { N: 2 ** 14, r: 8, p: 1 });
  const stored = ["scrypt", String(2 ** 14), "8", "1", salt.toString("base64"), legacy.toString("base64")].join("$");

  assert.equal(await verifyPassword("legacy-password-1", stored), true);
  assert.equal(await verifyPassword("legacy-password-2", stored), false);
});

test("malformed or hostile stored hashes are rejected without a crash", async () => {
  for (const stored of [
    "",
    "plaintext",
    "bcrypt$10$abc",
    "scrypt$not-a-number$8$1$c2FsdA==$aGFzaA==",
    "scrypt$99999999$8$1$c2FsdA==$aGFzaA==",
    "scrypt$16384$8$1$$aGFzaA==",
  ]) {
    assert.equal(await verifyPassword("anything", stored), false);
  }
  assert.equal(passwordProblem("short1"), "Password must be at least 10 characters.");
});
