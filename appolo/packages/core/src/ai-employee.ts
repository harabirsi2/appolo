import { z } from "zod";

/* ------------------------------------------------------------------ */
/* AI employee schemas                                                 */
/* ------------------------------------------------------------------ */

/**
 * Per-org AI employee configuration. Stored on `ai_agents.voice_profile`
 * (and related jsonb columns). Everything has a safe default so an org can
 * switch it on without configuring every field.
 */
export const aiAgentConfigSchema = z.object({
  enabled: z.boolean().default(false),
  greeting: z.string().trim().max(200).default(""),
  /** If any of these appear in the message, escalate to a human. */
  escalationKeywords: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
  /** Topics that are never answered automatically. */
  blockedTopics: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
  /** Minimum retrieval score (0-1) before an answer is considered grounded. */
  confidenceThreshold: z.number().min(0).max(1).default(0.34),
});

export type AiAgentConfig = z.infer<typeof aiAgentConfigSchema>;

export const DEFAULT_AI_AGENT: AiAgentConfig = {
  enabled: false,
  greeting: "Thanks for reaching out!",
  escalationKeywords: ["human", "person", "manager", "supervisor", "refund", "lawsuit", "attorney", "complaint"],
  blockedTopics: ["medical advice", "legal advice", "diagnosis"],
  confidenceThreshold: 0.34,
};

export const knowledgeDocSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(160),
  content: z.string().trim().min(1, "Content is required.").max(4000),
});

export type KnowledgeDocInput = z.infer<typeof knowledgeDocSchema>;

/* ------------------------------------------------------------------ */
/* deterministic retrieval + decisioning                              */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "with", "this", "that",
  "have", "has", "had", "was", "were", "can", "could", "would", "should", "will",
  "what", "when", "where", "who", "how", "why", "does", "did", "please", "thanks",
  "thank", "hello", "hi", "hey", "about", "from", "into", "our", "out", "get",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .map(stem);
}

/** Very small stemmer so "close"/"closed"/"closing" and "hours"/"hour" agree. */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 3 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  if (token.length > 4 && token.endsWith("e")) return token.slice(0, -1);
  return token;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  content: string;
}

export interface RetrievedDoc extends KnowledgeDoc {
  score: number;
}

/** Rank knowledge docs by keyword overlap with the question. */
export function retrieveKnowledge(query: string, docs: KnowledgeDoc[], limit = 3): RetrievedDoc[] {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return [];

  const lowered = query.toLowerCase();
  const scored = docs.map((doc) => {
    const docTokens = new Set(tokenize(`${doc.title} ${doc.content}`));
    let overlap = 0;
    for (const token of queryTokens) {
      if (docTokens.has(token)) overlap += 1;
    }
    const titlePhrase = doc.title.toLowerCase().trim();
    const phraseBonus = titlePhrase.length > 4 && lowered.includes(titlePhrase) ? 0.2 : 0;
    const score = Math.min(1, overlap / queryTokens.size + phraseBonus);
    return { ...doc, score };
  });

  return scored
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export interface AiDecisionInput {
  message: string;
  docs: KnowledgeDoc[];
  config: AiAgentConfig;
}

export interface AiDecision {
  action: "reply" | "handoff";
  reason: string;
  reply?: string;
  citations: { id: string; title: string }[];
}

/**
 * Deterministic first-line policy: escalate on escalation keywords and blocked
 * topics, answer only when a knowledge doc is a confident match, otherwise
 * hand off to a human. This runs before any model call, so the guardrails are
 * identical whether or not a model provider is configured.
 */
export function decideAiAction(input: AiDecisionInput): AiDecision {
  const text = input.message.toLowerCase();

  for (const topic of input.config.blockedTopics) {
    const needle = topic.trim().toLowerCase();
    if (needle && text.includes(needle)) {
      return { action: "handoff", reason: `blocked topic: ${topic}`, citations: [] };
    }
  }

  for (const keyword of input.config.escalationKeywords) {
    const needle = keyword.trim().toLowerCase();
    if (needle && text.includes(needle)) {
      return { action: "handoff", reason: `escalation keyword: ${keyword}`, citations: [] };
    }
  }

  const matches = retrieveKnowledge(input.message, input.docs, 3);
  const best = matches[0];
  if (!best || best.score < input.config.confidenceThreshold) {
    return { action: "handoff", reason: "no confident answer in the knowledge base", citations: [] };
  }

  const greeting = input.config.greeting.trim();
  const answer = best.content.trim();
  const reply = greeting ? `${greeting} ${answer}` : answer;

  return {
    action: "reply",
    reason: `matched "${best.title}" (${Math.round(best.score * 100)}%)`,
    reply: reply.slice(0, 1000),
    citations: matches.map((match) => ({ id: match.id, title: match.title })),
  };
}

/** Coerce a stored jsonb blob into a complete agent config. */
export function coerceAgentConfig(raw: unknown): AiAgentConfig {
  const value = (raw ?? {}) as Record<string, unknown>;
  const parsed = aiAgentConfigSchema.safeParse({
    enabled: value.enabled,
    greeting: value.greeting,
    escalationKeywords: value.escalationKeywords,
    blockedTopics: value.blockedTopics,
    confidenceThreshold: value.confidenceThreshold,
  });
  if (parsed.success) return parsed.data;
  return { ...DEFAULT_AI_AGENT };
}
