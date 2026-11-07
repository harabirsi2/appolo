/**
 * Keyword automations.
 *
 * Phase 3 ships the "keyword -> auto-reply" automation: an inbound message is
 * matched against enabled automations, and the first match sends a templated
 * reply (subject to the same consent rules as any other outbound message).
 * Runs are recorded so the activity is auditable.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import {
  automationSchema,
  firstMatchingAutomation,
  firstAutoReplyBody,
  renderAutomationReply,
  type AutomationInput,
} from "@appolo/core";
import { withOrg, schema } from "@/lib/db";
import { DomainError } from "./errors";
import { checkConsent } from "./consent";
import { ensureConversationForContact, sendOutboundMessage } from "./messaging";
import { recordAudit } from "./audit";

const { automations, automationSteps, automationRuns, contactEvents, contacts, orgs, tags, contactTags } = schema;

export interface AutomationWithSteps {
  id: string;
  name: string;
  trigger: string;
  enabled: boolean;
  conditions: unknown;
  createdAt: Date;
  updatedAt: Date;
  steps: { id: string; order: number; kind: string; config: unknown }[];
}

export async function listAutomations(orgId: string): Promise<AutomationWithSteps[]> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx
      .select()
      .from(automations)
      .where(eq(automations.orgId, orgId))
      .orderBy(desc(automations.createdAt));
    if (rows.length === 0) return [];

    const steps = await tx
      .select()
      .from(automationSteps)
      .where(eq(automationSteps.orgId, orgId))
      .orderBy(asc(automationSteps.order));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      trigger: row.trigger,
      enabled: row.enabled,
      conditions: row.conditions,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      steps: steps
        .filter((step) => step.automationId === row.id)
        .map((step) => ({ id: step.id, order: step.order, kind: step.kind, config: step.config })),
    }));
  });
}

function conditionsFromInput(input: AutomationInput) {
  return {
    keywords: input.keywords.map((k) => k.trim()),
    matchType: input.matchType,
    channels: input.channels,
  };
}

export async function createAutomation(
  orgId: string,
  input: AutomationInput,
  actorId: string,
): Promise<{ id: string }> {
  const parsed = automationSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", "Invalid automation.", 400);

  return withOrg(orgId, async (tx) => {
    const [automation] = await tx
      .insert(automations)
      .values({
        orgId,
        name: parsed.data.name,
        trigger: parsed.data.trigger,
        conditions: conditionsFromInput(parsed.data) as never,
        enabled: parsed.data.enabled,
      })
      .returning({ id: automations.id });

    const steps: { kind: string; config: unknown }[] = [];
    if (parsed.data.replyBody?.trim()) {
      steps.push({ kind: "auto_reply", config: { body: parsed.data.replyBody.trim() } });
    }
    if (steps.length > 0) {
      await tx.insert(automationSteps).values(
        steps.map((step, index) => ({
          orgId,
          automationId: automation!.id,
          order: index + 1,
          kind: step.kind,
          config: step.config as never,
        })),
      );
    }

    await recordAudit(tx, {
      orgId,
      actorId,
      action: "automation.created",
      entityType: "automation",
      entityId: automation!.id,
      after: { name: parsed.data.name, trigger: parsed.data.trigger },
    });
    return { id: automation!.id };
  });
}

export async function updateAutomation(
  orgId: string,
  id: string,
  input: AutomationInput,
  actorId: string,
): Promise<void> {
  const parsed = automationSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", "Invalid automation.", 400);

  await withOrg(orgId, async (tx) => {
    const [existing] = await tx.select({ id: automations.id }).from(automations).where(eq(automations.id, id)).limit(1);
    if (!existing) throw new DomainError("AUTOMATION_NOT_FOUND", "Automation not found.", 404);

    await tx
      .update(automations)
      .set({
        name: parsed.data.name,
        trigger: parsed.data.trigger,
        conditions: conditionsFromInput(parsed.data) as never,
        enabled: parsed.data.enabled,
        updatedAt: new Date(),
      })
      .where(eq(automations.id, id));

    await tx.delete(automationSteps).where(eq(automationSteps.automationId, id));
    if (parsed.data.replyBody?.trim()) {
      await tx.insert(automationSteps).values({
        orgId,
        automationId: id,
        order: 1,
        kind: "auto_reply",
        config: { body: parsed.data.replyBody.trim() } as never,
      });
    }

    await recordAudit(tx, {
      orgId,
      actorId,
      action: "automation.updated",
      entityType: "automation",
      entityId: id,
      after: { name: parsed.data.name, enabled: parsed.data.enabled },
    });
  });
}

export async function setAutomationEnabled(
  orgId: string,
  id: string,
  enabled: boolean,
  actorId: string,
): Promise<void> {
  await withOrg(orgId, async (tx) => {
    await tx.update(automations).set({ enabled, updatedAt: new Date() }).where(eq(automations.id, id));
    await recordAudit(tx, {
      orgId,
      actorId,
      action: enabled ? "automation.enabled" : "automation.disabled",
      entityType: "automation",
      entityId: id,
    });
  });
}

export async function deleteAutomation(orgId: string, id: string, actorId: string): Promise<void> {
  await withOrg(orgId, async (tx) => {
    await tx.delete(automations).where(eq(automations.id, id));
    await recordAudit(tx, {
      orgId,
      actorId,
      action: "automation.deleted",
      entityType: "automation",
      entityId: id,
    });
  });
}

export interface KeywordAutomationResult {
  matched: boolean;
  automationId?: string;
  sent: boolean;
  skippedReason?: string;
}

/**
 * Runs keyword automations for one inbound message. Never throws for
 * no-match or a blocked send: the caller is the inbound webhook, which must
 * still succeed. Genuine infrastructure errors are caught by the caller.
 */
export async function runKeywordAutomations(
  orgId: string,
  input: { contactId: string; channel: "sms" | "email" | "webchat"; body: string },
): Promise<KeywordAutomationResult> {
  const candidates = await listAutomations(orgId);
  const match = firstMatchingAutomation(
    candidates.map((a) => ({ ...a, steps: a.steps })),
    input.body,
    input.channel,
  );
  if (!match) return { matched: false, sent: false };

  const replyTemplate = firstAutoReplyBody(match.steps);
  if (!replyTemplate) return { matched: true, automationId: match.id, sent: false, skippedReason: "no reply step" };

  const consent = await checkConsent(orgId, input.contactId, input.channel);
  if (!consent.allowed) {
    await withOrg(orgId, (tx) =>
      tx.insert(automationRuns).values({
        orgId,
        automationId: match.id,
        contactId: input.contactId,
        state: "completed",
        lastError: consent.reason ?? "no consent",
      }),
    );
    return { matched: true, automationId: match.id, sent: false, skippedReason: consent.reason ?? "no consent" };
  }

  const context = await withOrg(orgId, async (tx) => {
    const [contact] = await tx
      .select({ name: contacts.name })
      .from(contacts)
      .where(eq(contacts.id, input.contactId))
      .limit(1);
    const [org] = await tx.select({ name: orgs.name }).from(orgs).limit(1);
    return { contact, org };
  });

  const body = renderAutomationReply(replyTemplate, {
    firstName: context.contact?.name?.split(/\s+/)[0] ?? null,
    businessName: context.org?.name ?? null,
  });

  const conversationId = await ensureConversationForContact(orgId, input.contactId, input.channel);
  const message = await sendOutboundMessage(orgId, conversationId, {
    body,
    senderType: "system",
  });

  await withOrg(orgId, async (tx) => {
    // Apply any add_tag steps now that the reply has gone out.
    for (const step of match.steps) {
      if (step.kind !== "add_tag") continue;
      const tagName = String((step.config as { tag?: unknown }).tag ?? "").trim().toLowerCase();
      if (!tagName) continue;
      let [tag] = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.orgId, orgId), eq(tags.name, tagName)))
        .limit(1);
      if (!tag) {
        [tag] = await tx.insert(tags).values({ orgId, name: tagName }).returning({ id: tags.id });
      }
      if (tag) {
        await tx.insert(contactTags).values({ orgId, contactId: input.contactId, tagId: tag.id }).onConflictDoNothing();
      }
    }

    await tx.insert(automationRuns).values({
      orgId,
      automationId: match.id,
      contactId: input.contactId,
      state: "completed",
      currentStep: 1,
    });
    await tx.insert(contactEvents).values({
      orgId,
      contactId: input.contactId,
      kind: "automation.ran",
      payload: { automationId: match.id, name: match.name, messageId: message.id },
    });
  });

  return { matched: true, automationId: match.id, sent: true };
}
