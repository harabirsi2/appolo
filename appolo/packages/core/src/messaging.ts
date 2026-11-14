import { z } from "zod";

export const conversationStatuses = ["open", "pending", "snoozed", "closed"] as const;
export type ConversationStatus = (typeof conversationStatuses)[number];

export const messageBodySchema = z
  .string()
  .trim()
  .min(1, "Message cannot be empty.")
  .max(4000, "Message is too long.");

export const sendMessageSchema = z.object({
  body: messageBodySchema,
});

export const conversationUpdateSchema = z
  .object({
    status: z.enum(conversationStatuses).optional(),
    assigneeId: z.string().uuid().nullish(),
    priority: z.number().int().min(0).max(9).optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "No changes supplied.",
  });

export const noteSchema = z.object({
  body: messageBodySchema,
});

export const savedReplySchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(80),
  body: z.string().trim().min(1, "Body is required.").max(2000),
  scope: z.enum(["org", "user"]).default("org"),
});

export const webchatCustomerSchema = z.object({
  body: messageBodySchema.max(2000),
  visitorId: z.string().trim().min(8, "Missing visitor id.").max(80),
  name: z.string().trim().max(120).optional(),
});

export const conversationQuerySchema = z.object({
  status: z.enum(conversationStatuses).optional(),
  channel: z.enum(["sms", "email", "webchat", "facebook", "instagram", "gbp"]).optional(),
  assignee: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ConversationUpdateInput = z.infer<typeof conversationUpdateSchema>;
export type SavedReplyInput = z.infer<typeof savedReplySchema>;
export type WebchatCustomerInput = z.infer<typeof webchatCustomerSchema>;

/**
 * Renders `{{variable}}` placeholders. Unknown variables render empty rather
 * than leaking the raw token into a customer message.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key] ?? variables[key.toLowerCase()];
    return value === null || value === undefined ? "" : String(value);
  });
}

export function firstName(name: string | null | undefined): string {
  if (!name) return "there";
  return name.trim().split(/\s+/)[0] ?? "there";
}

/** Rough segment estimate used to surface cost risk before sending. */
export function smsSegments(body: string): number {
  return Math.max(1, Math.ceil(body.length / 160));
}

/* ------------------------------------------------------------------ */
/* delivery status ordering (webhook replay protection)                */
/* ------------------------------------------------------------------ */

/** Every status a stored message may hold, ordered by delivery progress. */
export const MESSAGE_STATUS_ORDER = ["queued", "sent", "received", "delivered", "failed"] as const;
export type MessageDeliveryStatus = (typeof MESSAGE_STATUS_ORDER)[number];

/**
 * Delivery progress for a status. A callback may only move a message forward:
 * a replayed or out-of-order provider callback reporting an earlier state must
 * not regress a `delivered` message back to `sent`, and an identical status is
 * a no-op so replays cannot stack duplicate event rows.
 */
const MESSAGE_STATUS_RANK: Record<string, number> = {
  queued: 1,
  sent: 2,
  received: 2,
  delivered: 3,
  failed: 3,
};

export function messageStatusRank(status: string | null | undefined): number {
  if (!status) return 0;
  return MESSAGE_STATUS_RANK[status] ?? 0;
}

/** True when `incoming` represents strictly more progress than `current`. */
export function shouldApplyMessageStatus(
  current: string | null | undefined,
  incoming: string,
): boolean {
  return messageStatusRank(incoming) > messageStatusRank(current);
}

/** The known statuses strictly below `incoming`, for an atomic guarded update. */
export function messageStatusesBelow(incoming: string): MessageDeliveryStatus[] {
  const rank = messageStatusRank(incoming);
  return MESSAGE_STATUS_ORDER.filter((status) => messageStatusRank(status) < rank);
}