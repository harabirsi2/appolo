import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
for (const candidate of [path.join(pkgRoot, ".env"), path.join(pkgRoot, "..", "..", ".env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

import { getAdminDb } from "./client";
import * as schema from "./schema";

const { orgs, contacts, conversations, messages, messageEvents } = schema;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}`);
  }
}

async function main(): Promise<void> {
  const admin = getAdminDb();
  const A = randomUUID();
  const B = randomUUID();
  const stamp = randomUUID().slice(0, 8);
  const sid = `SM_IDEMPOTENCY_${stamp}`;

  try {
    await admin.insert(orgs).values({ id: A, name: `Idempotency A ${stamp}`, slug: `idem-a-${stamp}` });
    const [contact] = await admin
      .insert(contacts)
      .values({ orgId: A, name: "Idempotency Contact", source: "test" })
      .returning();
    const [conversation] = await admin
      .insert(conversations)
      .values({ orgId: A, contactId: contact!.id })
      .returning();
    const [message] = await admin
      .insert(messages)
      .values({
        orgId: A,
        conversationId: conversation!.id,
        direction: "inbound",
        senderType: "contact",
        body: "first",
        providerSid: sid,
        status: "received",
      })
      .returning();

    // A duplicate (org, provider_sid) is rejected at the database level.
    let duplicateRejected = false;
    try {
      await admin.insert(messages).values({
        orgId: A,
        conversationId: conversation!.id,
        direction: "inbound",
        senderType: "contact",
        body: "replay",
        providerSid: sid,
        status: "received",
      });
    } catch {
      duplicateRejected = true;
    }
    check("duplicate provider message id is rejected per org", duplicateRejected);

    // The service path uses onConflictDoNothing, which must be a clean no-op.
    const deduped = await admin
      .insert(messages)
      .values({
        orgId: A,
        conversationId: conversation!.id,
        direction: "inbound",
        senderType: "contact",
        body: "replay",
        providerSid: sid,
        status: "received",
      })
      .onConflictDoNothing({ target: [messages.orgId, messages.providerSid] })
      .returning({ id: messages.id });
    check("onConflictDoNothing dedupes a replayed inbound message", deduped.length === 0);

    // The same provider id in a different org is a different message.
    await admin.insert(orgs).values({ id: B, name: `Idempotency B ${stamp}`, slug: `idem-b-${stamp}` });
    const [contactB] = await admin
      .insert(contacts)
      .values({ orgId: B, name: "Idempotency Contact B", source: "test" })
      .returning();
    const [conversationB] = await admin
      .insert(conversations)
      .values({ orgId: B, contactId: contactB!.id })
      .returning();
    const [accepted] = await admin
      .insert(messages)
      .values({
        orgId: B,
        conversationId: conversationB!.id,
        direction: "inbound",
        senderType: "contact",
        body: "same sid, other org",
        providerSid: sid,
        status: "received",
      })
      .returning();
    check("the same provider id is allowed in a different org", Boolean(accepted));

    // Status events are unique per (message, event), so a replayed callback
    // cannot stack rows.
    await admin.insert(messageEvents).values({ orgId: A, messageId: message!.id, event: "status.delivered" });
    let eventRejected = false;
    try {
      await admin
        .insert(messageEvents)
        .values({ orgId: A, messageId: message!.id, event: "status.delivered" });
    } catch {
      eventRejected = true;
    }
    check("duplicate status event is rejected", eventRejected);

    const eventDeduped = await admin
      .insert(messageEvents)
      .values({ orgId: A, messageId: message!.id, event: "status.delivered" })
      .onConflictDoNothing({ target: [messageEvents.messageId, messageEvents.event] })
      .returning({ id: messageEvents.id });
    check("onConflictDoNothing dedupes a replayed status event", eventDeduped.length === 0);
  } finally {
    await admin.delete(orgs).where(eq(orgs.id, A));
    await admin.delete(orgs).where(eq(orgs.id, B));
  }

  console.log("---");
  console.log(`RESULT: pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("idempotency-test failed:", err);
  process.exit(1);
});
