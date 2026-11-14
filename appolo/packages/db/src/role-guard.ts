import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAppDatabaseEnforcesRls } from "./rls-guard";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
for (const candidate of [path.join(pkgRoot, ".env"), path.join(pkgRoot, "..", "..", ".env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

async function main(): Promise<void> {
  try {
    const status = await assertAppDatabaseEnforcesRls();
    console.log(
      `PASS  application role "${status.currentUser}" is not a superuser and cannot bypass row-level security`,
    );
  } catch (error) {
    console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("role-guard failed:", error);
  process.exit(1);
});
