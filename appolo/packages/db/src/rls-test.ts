import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
for (const candidate of [path.join(pkgRoot, ".env"), path.join(pkgRoot, "..", "..", ".env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

import { createDb, getDb, withOrg, getAdminDb } from "./client";
import * as schema from "./schema";
const { orgs, locations, contacts } = schema;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}`);
  }
}

async function roleInfo(): Promise<{ currentUser: string; bypass: boolean }> {
  const url = process.env.DATABASE_URL || "";
  const { client } = createDb(url, 1);
  try {
    const rows = await client<{ u: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      select current_user as u, rolsuper, rolbypassrls
      from pg_roles where rolname = current_user`;
    const r = rows[0]!;
    return { currentUser: r.u, bypass: r.rolsuper || r.rolbypassrls };
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const who = await roleInfo();
  if (who.bypass) {
    console.log(`SKIP  rls-test: connected as "${who.currentUser}" which bypasses RLS.`);
    console.log("      Set DATABASE_URL to the non-superuser appolo_app role to exercise policies.");
    process.exit(0);
  }

  const admin = getAdminDb();
  const A = randomUUID();
  const B = randomUUID();
  const stamp = randomUUID().slice(0, 8);

  try {
    await withOrg(A, async (tx) => {
      await tx.insert(orgs).values({ id: A, name: `Org A ${stamp}`, slug: `org-a-${stamp}` });
      await tx.insert(locations).values({ orgId: A, name: "A Main", timezone: "UTC" });
      await tx.insert(contacts).values({ orgId: A, name: "A Contact", source: "test" });
    });
    await withOrg(B, async (tx) => {
      await tx.insert(orgs).values({ id: B, name: `Org B ${stamp}`, slug: `org-b-${stamp}` });
      await tx.insert(locations).values({ orgId: B, name: "B Main", timezone: "UTC" });
      await tx.insert(contacts).values({ orgId: B, name: "B Contact", source: "test" });
    });

    const aLocations = await withOrg(A, (tx) => tx.select().from(locations));
    check("org A sees only its own location", aLocations.length === 1 && aLocations[0]!.orgId === A);

    const bLocations = await withOrg(B, (tx) => tx.select().from(locations));
    check("org B sees only its own location", bLocations.length === 1 && bLocations[0]!.orgId === B);

    const crossRead = await withOrg(A, (tx) =>
      tx.select().from(locations).where(eq(locations.id, bLocations[0]!.id)),
    );
    check("cross-org read by id returns nothing", crossRead.length === 0);

    const aContacts = await withOrg(A, (tx) => tx.select().from(contacts));
    check("contacts are isolated per org", aContacts.length === 1 && aContacts[0]!.name === "A Contact");

    let writeBlocked = false;
    try {
      await withOrg(A, (tx) => tx.insert(locations).values({ orgId: B, name: "Smuggled", timezone: "UTC" }));
    } catch {
      writeBlocked = true;
    }
    check("cross-org insert is rejected by WITH CHECK", writeBlocked);

    let orgsVisible = 0;
    await withOrg(A, async (tx) => {
      const all = await tx.select().from(orgs);
      orgsVisible = all.length;
    });
    check("orgs table is scoped to the active org", orgsVisible === 1);

    // No org context at all -> no tenant rows.
    const noContext = await getDb().select().from(locations).where(eq(locations.orgId, A));
    check("no org context yields no rows", noContext.length === 0);
  } finally {
    await admin.delete(orgs).where(inArray(orgs.id, [A, B]));
  }

  console.log("---");
  console.log(`RESULT: pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("rls-test failed:", err);
  process.exit(1);
});