/**
 * AI drafting.
 *
 * Phase 3 ships a deterministic, policy-safe fallback that needs no
 * credentials. When `OPENAI_API_KEY` is configured, review replies are drafted
 * with the Chat Completions API using a tightly constrained prompt. The model
 * never publishes anything: drafts are always human-approved before posting.
 */
import { draftReplyFallback, type ReplyTone } from "@appolo/core";

export interface DraftReplyInput {
  authorName: string | null;
  rating: number;
  body: string | null;
  businessName: string | null;
  tone?: ReplyTone;
}

export interface DraftReplyResult {
  body: string;
  aiGenerated: boolean;
  provider: "openai" | "heuristic";
}

const DEFAULT_MODEL = "gpt-4o-mini";

function systemPrompt(businessName: string | null): string {
  const business = (businessName ?? "the business").trim() || "the business";
  return [
    `You write short, warm, professional replies to public reviews on behalf of ${business}.`,
    "Rules:",
    "- 2 to 4 sentences. Plain text only, no markdown.",
    "- Never offer refunds, discounts, freebies, or compensation.",
    "- Never ask the reviewer to edit or remove their review.",
    "- Never confirm private customer details or make legal claims.",
    "- For critical reviews, apologize sincerely and invite an offline follow-up.",
    "- Sign off with a dash and the business name.",
  ].join("\n");
}

function userPrompt(input: DraftReplyInput): string {
  const stars = `${input.rating} out of 5`;
  const tone = input.tone ?? "friendly";
  return [
    `Tone: ${tone}.`,
    `Reviewer name: ${input.authorName ?? "unknown"}.`,
    `Star rating: ${stars}.`,
    `Review text: ${input.body?.trim() || "(no text)"}.`,
    "Write the reply now.",
  ].join("\n");
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export async function draftReviewReply(input: DraftReplyInput): Promise<DraftReplyResult> {
  const fallback = (): DraftReplyResult => ({
    body: draftReplyFallback(input),
    aiGenerated: false,
    provider: "heuristic",
  });

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return fallback();

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL?.trim() || DEFAULT_MODEL,
        temperature: 0.6,
        max_tokens: 220,
        messages: [
          { role: "system", content: systemPrompt(input.businessName) },
          { role: "user", content: userPrompt(input) },
        ],
      }),
    });

    if (!response.ok) return fallback();
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) return fallback();
    return { body: text.slice(0, 2000), aiGenerated: true, provider: "openai" };
  } catch {
    return fallback();
  }
}
