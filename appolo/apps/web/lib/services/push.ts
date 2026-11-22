import { and, eq } from "drizzle-orm";
import { withOrg, schema } from "@/lib/db";
import { DomainError } from "./errors";

/**
 * Push subscriptions are per device, not per account: the endpoint URL is
 * unique, so a second person signing in on the same browser takes the row over
 * instead of adding a second one (and stops the first person's notifications).
 */

const { pushSubscriptions } = schema;

export interface PushSubscriptionInput {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

export function pushPublicKey(): string | null {
  return process.env.PUSH_VAPID_PUBLIC_KEY?.trim() || null;
}

function parseInput(input: PushSubscriptionInput) {
  const endpoint = typeof input.endpoint === "string" ? input.endpoint.trim() : "";
  const p256dh = typeof input.keys?.p256dh === "string" ? input.keys.p256dh : "";
  const auth = typeof input.keys?.auth === "string" ? input.keys.auth : "";
  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    throw new DomainError("INVALID_SUBSCRIPTION", "That browser sent an incomplete subscription.", 400);
  }
  return { endpoint, p256dh, auth };
}

export async function savePushSubscription(
  orgId: string,
  input: PushSubscriptionInput,
  userAgent: string | null,
): Promise<void> {
  const { endpoint, p256dh, auth } = parseInput(input);
  await withOrg(orgId, (tx) =>
    tx
      .insert(pushSubscriptions)
      .values({ orgId, endpoint, p256dh, auth, userAgent })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { orgId, p256dh, auth, userAgent, enabled: true, failureCount: 0, updatedAt: new Date() },
      }),
  );
}

export async function removePushSubscription(orgId: string, endpoint: string): Promise<void> {
  await withOrg(orgId, (tx) =>
    tx
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.orgId, orgId), eq(pushSubscriptions.endpoint, endpoint))),
  );
}
