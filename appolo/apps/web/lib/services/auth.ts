import { cookies, headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { slugify, withSuffix } from "@appolo/core";
import { getDb, schema } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/constants";
import {
  hashPassword,
  normalizeEmail,
  randomToken,
  sha256,
  verifyPassword,
  type LoginInput,
  type SignupInput,
} from "@appolo/core";

const { orgs, locations, users, memberships, sessions } = schema;

const SESSION_DAYS = 30;

export type AuthResult = { ok: true } | { ok: false; error: string };

function pgCode(err: unknown): string | undefined {
  return (err as { code?: string } | undefined)?.code;
}

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0]!.trim() : h.get("x-real-ip");
  return { ip: ip ?? null, userAgent: h.get("user-agent") };
}

async function createSession(userId: string): Promise<void> {
  const db = getDb();
  const raw = randomToken(32);
  const meta = await requestMeta();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(raw),
    expiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function signUp(input: SignupInput): Promise<AuthResult> {
  const db = getDb();
  const email = normalizeEmail(input.email);

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return { ok: false, error: "An account with that email already exists." };
  }

  const orgId = randomUUID();
  const passwordHash = hashPassword(input.password);
  const baseSlug = slugify(input.orgName);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : withSuffix(baseSlug);
    try {
      const created = await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);

        await tx.insert(orgs).values({ id: orgId, name: input.orgName, slug, planTier: "trial" });
        const [user] = await tx
          .insert(users)
          .values({ email, name: input.name, passwordHash })
          .returning({ id: users.id });
        if (!user) throw new Error("user insert failed");

        await tx.insert(memberships).values({
          orgId,
          userId: user.id,
          role: "owner",
          status: "active",
        });
        await tx.insert(locations).values({
          orgId,
          name: input.locationName ?? "Main location",
          timezone: input.timezone,
        });
        return user;
      });

      await createSession(created.id);
      return { ok: true };
    } catch (err) {
      if (pgCode(err) === "23505") {
        // Most likely a slug collision; retry with a suffix.
        continue;
      }
      console.error("signup failed", err);
      return { ok: false, error: "Could not create the account. Please try again." };
    }
  }

  return { ok: false, error: "Could not allocate a unique workspace name. Try a different business name." };
}

export async function signIn(input: LoginInput): Promise<AuthResult> {
  const db = getDb();
  const email = normalizeEmail(input.email);

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    return { ok: false, error: "Invalid email or password." };
  }

  const member = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .limit(1);
  if (!member[0]) {
    return { ok: false, error: "This account is not attached to a workspace." };
  }

  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
  await createSession(user.id);
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (raw) {
    await getDb().delete(sessions).where(eq(sessions.tokenHash, sha256(raw)));
  }
  store.delete(SESSION_COOKIE);
}