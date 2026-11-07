/**
 * Campaigns / broadcasts.
 *
 * A campaign resolves a segment to a set of contacts and sends one templated
 * message per recipient. Consent is enforced per recipient (a recipient
 * without consent is skipped, never silently sent), quiet hours block the whole
 * send, and a daily cap matches the org's existing send policy.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  campaignSchema,
  isWithinQuietHours,
  renderTemplate,
  resolveSegment,
  type CampaignInput,
  type CampaignSegment,
} from "@appolo/core";
import { withOrg, schema } from "@/lib/db";
import { DomainError } from "./errors";
import { checkConsent } from "./consent";
import { ensureConversationForContact, sendOutboundMessage } from "./messaging";
import { getReviewSettings } from "./reviews";
import { recordAudit } from "./audit";

const { campaigns, campaignRecipients, contacts, contactTags, tags, orgs } = schema;

export async function listCampaigns(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const rows = await tx
      .select()
      .from(campaigns)
      .where(eq(campaigns.orgId, orgId))
      .orderBy(desc(campaigns.createdAt));
    if (rows.length === 0) return [];

    const counts = await tx
      .select({
        campaignId: campaignRecipients.campaignId,
        status: campaignRecipients.status,
        n: sql<number>`count(*)::int`,
      })
      .from(campaignRecipients)
      .where(eq(campaignRecipients.orgId, orgId))
      .groupBy(campaignRecipients.campaignId, campaignRecipients.status);

    return rows.map((row) => {
      const mine = counts.filter((c) => c.campaignId === row.id);
      const by = (status: string) => mine.find((c) => c.status === status)?.n ?? 0;
      return {
        ...row,
        total: mine.reduce((sum, c) => sum + c.n, 0),
        sent: by("sent"),
        skipped: by("skipped"),
        failed: by("failed"),
        pending: by("pending"),
      };
    });
  });
}

/** Contacts with their tags, used to preview and resolve segments. */
export async function segmentContacts(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const rows = await tx
      .select({
        id: contacts.id,
        name: contacts.name,
        tag: tags.name,
      })
      .from(contacts)
      .leftJoin(contactTags, eq(contactTags.contactId, contacts.id))
      .leftJoin(tags, eq(tags.id, contactTags.tagId))
      .where(eq(contacts.orgId, orgId));

    const byId = new Map<string, { id: string; name: string | null; tags: string[] }>();
    for (const row of rows) {
      const entry = byId.get(row.id) ?? { id: row.id, name: row.name, tags: [] };
      if (row.tag) entry.tags.push(row.tag);
      byId.set(row.id, entry);
    }
    return [...byId.values()];
  });
}

export async function previewSegment(
  orgId: string,
  segment: CampaignSegment,
  tag: string | null,
): Promise<number> {
  const contactsList = await segmentContacts(orgId);
  return resolveSegment(segment, tag, contactsList).length;
}

export async function createCampaign(
  orgId: string,
  input: CampaignInput,
  actorId: string,
): Promise<{ id: string; recipients: number }> {
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", "Invalid campaign.", 400);

  const contactsList = await segmentContacts(orgId);
  const segment = resolveSegment(parsed.data.segment, parsed.data.tag ?? null, contactsList);
  if (segment.length === 0) {
    throw new DomainError("EMPTY_SEGMENT", "That segment has no contacts.", 409);
  }

  return withOrg(orgId, async (tx) => {
    const [campaign] = await tx
      .insert(campaigns)
      .values({
        orgId,
        name: parsed.data.name,
        channel: parsed.data.channel,
        segment: {
          type: parsed.data.segment,
          tag: parsed.data.tag ?? null,
          subject: parsed.data.subject ?? null,
          body: parsed.data.body,
        } as never,
        status: "draft",
      })
      .returning({ id: campaigns.id });

    await tx.insert(campaignRecipients).values(
      segment.map((contact) => ({
        orgId,
        campaignId: campaign!.id,
        contactId: contact.id,
        status: "pending",
      })),
    );

    await recordAudit(tx, {
      orgId,
      actorId,
      action: "campaign.created",
      entityType: "campaign",
      entityId: campaign!.id,
      after: { name: parsed.data.name, recipients: segment.length },
    });
    return { id: campaign!.id, recipients: segment.length };
  });
}

export async function deleteCampaign(orgId: string, id: string, actorId: string): Promise<void> {
  await withOrg(orgId, async (tx) => {
    await tx.delete(campaigns).where(eq(campaigns.id, id));
    await recordAudit(tx, { orgId, actorId, action: "campaign.deleted", entityType: "campaign", entityId: id });
  });
}

export interface SendCampaignResult {
  sent: number;
  skipped: number;
  failed: number;
  results: { contactId: string; ok: boolean; reason?: string }[];
}

export async function sendCampaign(
  orgId: string,
  campaignId: string,
  actorId: string,
): Promise<SendCampaignResult> {
  const settings = await getReviewSettings(orgId);
  const now = new Date();
  if (isWithinQuietHours(settings.quietHours, settings.timezone, now)) {
    throw new DomainError(
      "QUIET_HOURS",
      `It's outside business hours (${settings.quietHours.start}–${settings.quietHours.end} local). Try again later.`,
      409,
    );
  }

  const campaign = await withOrg(orgId, async (tx) => {
    const [row] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    if (!row) throw new DomainError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
    if (row.status === "sent") throw new DomainError("ALREADY_SENT", "This campaign was already sent.", 409);

    const recipients = await tx
      .select({
        id: campaignRecipients.id,
        contactId: campaignRecipients.contactId,
        status: campaignRecipients.status,
        contactName: contacts.name,
      })
      .from(campaignRecipients)
      .leftJoin(contacts, eq(contacts.id, campaignRecipients.contactId))
      .where(and(eq(campaignRecipients.campaignId, campaignId), inArray(campaignRecipients.status, ["pending"])));

    return { row, recipients };
  });

  const cap = settings.dailyCap > 0 ? settings.dailyCap : 500;
  if (campaign.recipients.length > cap) {
    throw new DomainError(
      "DAILY_CAP",
      `This campaign has ${campaign.recipients.length} recipients, above the ${cap}/day send cap.`,
      429,
    );
  }

  const meta = (campaign.row.segment ?? {}) as { subject?: string; body?: string };
  const body = meta.body ?? "";
  const channel = campaign.row.channel === "email" ? "email" : "sms";

  const [org] = await withOrg(orgId, (tx) => tx.select({ name: orgs.name }).from(orgs).limit(1));
  const businessName = org?.name ?? "our business";

  await withOrg(orgId, (tx) =>
    tx.update(campaigns).set({ status: "sending" }).where(eq(campaigns.id, campaignId)),
  );

  const result: SendCampaignResult = { sent: 0, skipped: 0, failed: 0, results: [] };

  for (const recipient of campaign.recipients) {
    try {
      const consent = await checkConsent(orgId, recipient.contactId, channel);
      if (!consent.allowed) {
        result.skipped += 1;
        result.results.push({ contactId: recipient.contactId, ok: false, reason: consent.reason });
        await withOrg(orgId, (tx) =>
          tx
            .update(campaignRecipients)
            .set({ status: "skipped", error: consent.reason ?? "no consent" })
            .where(eq(campaignRecipients.id, recipient.id)),
        );
        continue;
      }

      const rendered = renderTemplate(body, {
        first_name: recipient.contactName?.split(/\s+/)[0] ?? "there",
        business_name: businessName,
      });
      const conversationId = await ensureConversationForContact(orgId, recipient.contactId, channel);
      const message = await sendOutboundMessage(orgId, conversationId, {
        body: rendered,
        subject: meta.subject ?? null,
        senderType: actorId ? "user" : "system",
        senderId: actorId,
      });

      result.sent += 1;
      result.results.push({ contactId: recipient.contactId, ok: true });
      await withOrg(orgId, (tx) =>
        tx
          .update(campaignRecipients)
          .set({ status: "sent", messageId: message.id })
          .where(eq(campaignRecipients.id, recipient.id)),
      );
    } catch (error) {
      result.failed += 1;
      result.results.push({
        contactId: recipient.contactId,
        ok: false,
        reason: error instanceof Error ? error.message : "Failed",
      });
      await withOrg(orgId, (tx) =>
        tx
          .update(campaignRecipients)
          .set({ status: "failed", error: error instanceof Error ? error.message : "Failed" })
          .where(eq(campaignRecipients.id, recipient.id)),
      );
    }
  }

  await withOrg(orgId, async (tx) => {
    await tx.update(campaigns).set({ status: "sent" }).where(eq(campaigns.id, campaignId));
    await recordAudit(tx, {
      orgId,
      actorId,
      action: "campaign.sent",
      entityType: "campaign",
      entityId: campaignId,
      after: { sent: result.sent, skipped: result.skipped, failed: result.failed },
    });
  });

  return result;
}
