/**
 * Cross-tenant isolation guard.
 *
 * Every tenant query relies on row-level security. That only works while the
 * application connects as a role with RLS enforced: a superuser or a role with
 * BYPASSRLS sees every organisation's rows and silently turns every policy into
 * a no-op. This check is cheap and deliberately loud, because the failure mode
 * is a cross-customer data leak rather than a wrong number on a page.
 */
import { createDb } from "./client";

export interface AppRoleStatus {
  currentUser: string;
  superuser: boolean;
  bypassRls: boolean;
}

function requireUrl(url?: string): string {
  const value = url ?? process.env.DATABASE_URL;
  if (!value) {
    throw new Error("DATABASE_URL is required to check the application database role");
  }
  return value;
}

/** Read the connected role's RLS-relevant attributes from Postgres itself. */
export async function inspectAppRole(url?: string): Promise<AppRoleStatus> {
  const { client } = createDb(requireUrl(url), 1);
  try {
    const rows = await client<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      select current_user, rolsuper, rolbypassrls
      from pg_roles
      where rolname = current_user
    `;
    const row = rows[0];
    if (!row) {
      throw new Error("could not read the connected role from pg_roles");
    }
    return {
      currentUser: row.current_user,
      superuser: row.rolsuper,
      bypassRls: row.rolbypassrls,
    };
  } finally {
    await client.end();
  }
}

/** Throw unless the connected role is subject to every RLS policy. */
export function assertAppRoleEnforcesRls(status: AppRoleStatus): void {
  if (status.superuser) {
    throw new Error(
      `application role "${status.currentUser}" is a superuser, so row-level security is bypassed. ` +
        "Point DATABASE_URL at the non-superuser app role (see .env.example).",
    );
  }
  if (status.bypassRls) {
    throw new Error(
      `application role "${status.currentUser}" has BYPASSRLS, so row-level security is bypassed. ` +
        "Revoke it with `alter role ... nobypassrls` and use a role that enforces policies.",
    );
  }
}

/** Inspect the configured application role and fail if it can bypass RLS. */
export async function assertAppDatabaseEnforcesRls(url?: string): Promise<AppRoleStatus> {
  const status = await inspectAppRole(url);
  assertAppRoleEnforcesRls(status);
  return status;
}
