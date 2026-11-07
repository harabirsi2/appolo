import { desc, eq } from "drizzle-orm";
import {
  canSendOnChannel,
  grantedChannels,
  type ConsentChannel,
  type ConsentDecision,
} from "@appolo/core";
import { withOrg, schema } from "@/lib/db";
import type { ConsentInput } from "@appolo/core";

const { consentRecords, contactEvents } = schema;

export async function listConsentRecords(orgId: string, contactId: string) {
  return withOrg(orgId, (tx) =>
    tx
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.contactId, contactId))
      .orderBy(desc(consentRecords.capturedAt)),
  );
}

export async function recordConsent(
  orgId: string,
  contactId: string,
  input: ConsentInput,
  meta: { ip?: string | null } = {},
) {
  return withOrg(orgId, async (tx) => {
    const [record] = await tx
      .insert(consentRecords)
      .values({
        orgId,
        contactId,
        channel: input.channel,
        status: input.status,
        source: input.source,
        ip: meta.ip ?? null,
        evidence: input.evidence ?? {},
      })
      .returning();

    await tx.insert(contactEvents).values({
      orgId,
      contactId,
      kind: input.status === "revoked" ? "consent.revoked" : "consent.granted",
      payload: { channel: input.channel, source: input.source },
    });

    return record!;
  });
}

export async function checkConsent(
  orgId: string,
  contactId: string,
  channel: ConsentChannel,
): Promise<ConsentDecision> {
  const records = await listConsentRecords(orgId, contactId);
  return canSendOnChannel(records, channel);
}

export async function consentSummary(orgId: string, contactId: string) {
  const records = await listConsentRecords(orgId, contactId);
  const latest: Record<string, string> = {};
  for (const record of records) {
    if (!(record.channel in latest)) latest[record.channel] = record.status;
  }
  return {
    records,
    granted: grantedChannels(records),
    latest,
  };
}