import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { getDb, withOrg, schema } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/constants";
import { capabilitiesFor, sha256, type Capability, type Role } from "@appolo/core";

const { sessions, users, memberships, orgs } = schema;

export interface SessionContext {
  user: { id: string; email: string; name: string };
  sessionId: string;
  org: { id: string; name: string; slug: string; planTier: string };
  membership: { id: string; role: Role; locationIds: string[] };
  capabilities: readonly Capability[];
}

/**
 * Read the session for the current request. Memoised per render with React's
 * `cache` so a layout, page and nested server component share one lookup
 * instead of running the session + workspace queries three times.
 *
 * Disabled/invited memberships are rejected (not merely hidden) and the
 * oldest membership wins when a user somehow belongs to more than one
 * workspace, so the active workspace is never arbitrary.
 */
const readSession = cache(async (): Promise<SessionContext | null> => {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const db = getDb();
  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      membershipId: memberships.id,
      role: memberships.role,
      locationIds: memberships.locationIds,
      orgId: memberships.orgId,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, sha256(raw)),
        gt(sessions.expiresAt, new Date()),
        eq(memberships.status, "active"),
      ),
    )
    .orderBy(memberships.createdAt)
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const orgRows = await withOrg(row.orgId, (tx) =>
    tx
      .select({ id: orgs.id, name: orgs.name, slug: orgs.slug, planTier: orgs.planTier })
      .from(orgs)
      .limit(1),
  );
  const org = orgRows[0];
  if (!org) return null;

  return {
    user: { id: row.userId, email: row.email, name: row.name },
    sessionId: row.sessionId,
    org,
    membership: {
      id: row.membershipId,
      role: row.role as Role,
      locationIds: row.locationIds,
    },
    capabilities: capabilitiesFor(row.role as Role),
  };
});

export function getSession(): Promise<SessionContext | null> {
  return readSession();
}

export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}