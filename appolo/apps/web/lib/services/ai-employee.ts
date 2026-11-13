/**
 * AI Employee (Phase 4, first slice).
 *
 * Answers an inbound message from the org knowledge base when it can do so
 * confidently, and otherwise escalates to a human. Guardrails are enforced
 * deterministically in `@appolo/core` before anything is sent, so the behaviour
 * is identical with or without a model provider. Every turn is recorded and
 * audited; the AI never answers without a grounded knowledge match.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import {
  coerceAgentConfig,
  decideAiAction,
  knowledgeDocSchema,
  type AiAgentConfig,
  type KnowledgeDoc,
} from "@appolo/core";
import { withOrg, schema } from "@/lib/db";
import { DomainError } from "./errors";
import { checkConsent } from "./consent";
import { ensureConversationForContact, sendOutboundMessage } from "./messaging";
import { recordAudit } from "./audit";

const {
  aiAgents,
  aiConversations,
  aiKnowledgeDocs,
  aiKnowledgeChunks,
  aiTurns,
  internalNotes,
} = schema;

export interface AiAgentView {
  id: string;
  name: string;
  model: string | null;
  config: AiAgentConfig;
}

/** Every org gets one AI agent row; created on first read. */
export async function ensureAiAgent(orgId: string): Promise<AiAgentView> {
  return withOrg(orgId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(aiAgents)
      .where(eq(aiAgents.orgId, orgId))
      .orderBy(aiAgents.createdAt)
      .limit(1);
    if (existing) {
      return { id: existing.id, name: existing.name, model: existing.model, config: coerceAgentConfig(existing.voiceProfile) };
    }

    const [created] = await tx
      .insert(aiAgents)
      .values({ orgId, name: "AI Employee", enabled: false })
      .returning();
    return { id: created!.id, name: created!.name, model: created!.model, config: coerceAgentConfig(created!.voiceProfile) };
  });
}

export async function updateAiAgent(orgId: string, input: AiAgentConfig, actorId: string): Promise<void> {
  const agent = await ensureAiAgent(orgId);
  const config = coerceAgentConfig(input);

  await withOrg(orgId, async (tx) => {
    await tx
      .update(aiAgents)
      .set({ enabled: config.enabled, voiceProfile: config as never })
      .where(eq(aiAgents.id, agent.id));

    await recordAudit(tx, {
      orgId,
      actorId,
      action: config.enabled ? "ai.enabled" : "ai.updated",
      entityType: "ai_agent",
      entityId: agent.id,
      after: { enabled: config.enabled, escalationKeywords: config.escalationKeywords.length },
    });
  });
}

/** Documents with their full text, ready for retrieval. */
export async function listKnowledgeDocs(orgId: string): Promise<KnowledgeDoc[]> {
  return withOrg(orgId, async (tx) => {
    const docs = await tx
      .select({ id: aiKnowledgeDocs.id, title: aiKnowledgeDocs.title, createdAt: aiKnowledgeDocs.createdAt })
      .from(aiKnowledgeDocs)
      .where(eq(aiKnowledgeDocs.orgId, orgId))
      .orderBy(desc(aiKnowledgeDocs.createdAt));
    if (docs.length === 0) return [];

    const chunks = await tx
      .select({ docId: aiKnowledgeChunks.docId, content: aiKnowledgeChunks.content })
      .from(aiKnowledgeChunks)
      .where(eq(aiKnowledgeChunks.orgId, orgId))
      .orderBy(asc(aiKnowledgeChunks.docId));

    const byDoc = new Map<string, string[]>();
    for (const chunk of chunks) {
      const list = byDoc.get(chunk.docId) ?? [];
      list.push(chunk.content);
      byDoc.set(chunk.docId, list);
    }

    return docs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      content: (byDoc.get(doc.id) ?? []).join("\n\n"),
    }));
  });
}

export async function createKnowledgeDoc(
  orgId: string,
  input: { title: string; content: string },
  actorId: string,
): Promise<{ id: string }> {
  const parsed = knowledgeDocSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", "Enter a title and some content.", 400);

  return withOrg(orgId, async (tx) => {
    const checksum = Buffer.from(`${parsed.data.title}:${parsed.data.content}`).toString("base64url").slice(0, 32);
    const [doc] = await tx
      .insert(aiKnowledgeDocs)
      .values({
        orgId,
        title: parsed.data.title,
        sourceType: "text",
        status: "ready",
        checksum,
      })
      .returning({ id: aiKnowledgeDocs.id });

    await tx.insert(aiKnowledgeChunks).values({
      orgId,
      docId: doc!.id,
      content: parsed.data.content,
      tokenCount: Math.ceil(parsed.data.content.length / 4),
    });

    await recordAudit(tx, {
      orgId,
      actorId,
      action: "ai.knowledge_added",
      entityType: "ai_knowledge_doc",
      entityId: doc!.id,
      after: { title: parsed.data.title },
    });
    return { id: doc!.id };
  });
}

export async function deleteKnowledgeDoc(orgId: string, id: string, actorId: string): Promise<void> {
  await withOrg(orgId, async (tx) => {
    await tx.delete(aiKnowledgeDocs).where(eq(aiKnowledgeDocs.id, id));
    await recordAudit(tx, {
      orgId,
      actorId,
      action: "ai.knowledge_removed",
      entityType: "ai_knowledge_doc",
      entityId: id,
    });
  });
}

async function ensureAiConversation(
  orgId: string,
  conversationId: string,
  agentId: string,
): Promise<string> {
  return withOrg(orgId, async (tx) => {
    const [existing] = await tx
      .select({ id: aiConversations.id })
      .from(aiConversations)
      .where(eq(aiConversations.conversationId, conversationId))
      .limit(1);
    if (existing) return existing.id;

    const [created] = await tx
      .insert(aiConversations)
      .values({ orgId, conversationId, agentId, state: "active" })
      .returning({ id: aiConversations.id });
    return created!.id;
  });
}

async function recordTurn(
  orgId: string,
  aiConversationId: string,
  input: { role: "user" | "assistant"; content: string; reason?: string },
): Promise<void> {
  await withOrg(orgId, (tx) =>
    tx.insert(aiTurns).values({
      orgId,
      aiConversationId,
      role: input.role,
      content: input.content.slice(0, 4000),
      toolCalls: (input.reason ? [{ kind: "note", reason: input.reason }] : []) as never,
      model: "heuristic",
    }),
  );
}

export interface AiAnswerResult {
  action: "reply" | "handoff" | "skipped";
  reason: string;
  reply?: string;
  sent: boolean;
  conversationId?: string;
}

/**
 * Answer (or escalate) one inbound message. Never throws for a policy outcome;
 * callers are inbound webhooks that must still succeed.
 */
export async function answerInboundMessage(
  orgId: string,
  input: { contactId: string; channel: "sms" | "email" | "webchat"; body: string; conversationId?: string },
): Promise<AiAnswerResult> {
  const agent = await ensureAiAgent(orgId);
  if (!agent.config.enabled) return { action: "skipped", reason: "AI employee is disabled", sent: false };

  const docs = await listKnowledgeDocs(orgId);
  const decision = decideAiAction({
    message: input.body,
    docs,
    config: agent.config,
  });

  let conversationId = input.conversationId;
  if (!conversationId) {
    conversationId = await ensureConversationForContact(orgId, input.contactId, input.channel);
  }
  const aiConversationId = await ensureAiConversation(orgId, conversationId, agent.id);
  await recordTurn(orgId, aiConversationId, { role: "user", content: input.body });

  if (decision.action === "reply" && decision.reply) {
    const consent = await checkConsent(orgId, input.contactId, input.channel);
    if (!consent.allowed) {
      return handoff(orgId, {
        aiConversationId,
        conversationId,
        agentId: agent.id,
        reason: consent.reason ?? "no consent",
        contactNote: decision.reason,
      });
    }

    try {
      const message = await sendOutboundMessage(orgId, conversationId, {
        body: decision.reply,
        senderType: "ai",
      });
      await recordTurn(orgId, aiConversationId, { role: "assistant", content: decision.reply, reason: decision.reason });
      await withOrg(orgId, (tx) =>
        recordAudit(tx, {
          orgId,
          action: "ai.replied",
          entityType: "conversation",
          entityId: conversationId,
          after: { messageId: message.id, citations: decision.citations.map((c) => c.title).slice(0, 3) },
        }),
      );
      return { action: "reply", reason: decision.reason, reply: decision.reply, sent: true, conversationId };
    } catch (error) {
      // A send failure is an infrastructure problem, not a policy outcome.
      return handoff(orgId, {
        aiConversationId,
        conversationId,
        agentId: agent.id,
        reason: error instanceof Error ? error.message : "send failed",
        contactNote: decision.reason,
      });
    }
  }

  return handoff(orgId, {
    aiConversationId,
    conversationId,
    agentId: agent.id,
    reason: decision.reason,
    contactNote: decision.reason,
  });
}

async function handoff(
  orgId: string,
  input: {
    aiConversationId: string;
    conversationId: string;
    agentId: string;
    reason: string;
    contactNote?: string;
  },
): Promise<AiAnswerResult> {
  await withOrg(orgId, async (tx) => {
    await tx
      .update(aiConversations)
      .set({ state: "handoff", handoffAt: new Date(), handoffReason: input.reason })
      .where(eq(aiConversations.id, input.aiConversationId));
    await tx.insert(internalNotes).values({
      orgId,
      conversationId: input.conversationId,
      authorId: null,
      body: `AI escalated this conversation: ${input.reason}.`,
    });
    await recordAudit(tx, {
      orgId,
      action: "ai.escalated",
      entityType: "conversation",
      entityId: input.conversationId,
      after: { reason: input.reason, match: input.contactNote },
    });
  });

  return { action: "handoff", reason: input.reason, sent: false, conversationId: input.conversationId };
}

/** Count of AI-handled conversations, for the UI. */
export async function aiStats(orgId: string): Promise<{ conversations: number; handoffs: number; replies: number }> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx
      .select({ state: aiConversations.state })
      .from(aiConversations)
      .where(eq(aiConversations.orgId, orgId));
    const replies = await tx
      .select({ id: aiTurns.id })
      .from(aiTurns)
      .where(and(eq(aiTurns.orgId, orgId), eq(aiTurns.role, "assistant")));
    return {
      conversations: rows.length,
      handoffs: rows.filter((row) => row.state === "handoff").length,
      replies: replies.length,
    };
  });
}
