#!/usr/bin/env node
/**
 * Browser-driven visual checks for the main Appolo screens.
 *
 * Signs in with the seeded demo account, visits each main screen, and fails on
 * page errors, console errors, 5xx responses, a wrong title, a missing heading,
 * empty content, a blank screenshot or a screenshot that differs from its
 * committed baseline. Snapshots are written to scripts/visual-output/.
 *
 * Baselines live in scripts/visual-baselines/. Accept intentional visual
 * changes with:
 *   VISUAL_UPDATE=1 pnpm visual
 *
 * Usage:
 *   pnpm exec playwright install chromium
 *   pnpm dev       # in one terminal
 *   pnpm visual    # in another
 *
 * BASE_URL, VISUAL_EMAIL, VISUAL_PASSWORD, VISUAL_OUT_DIR and
 * VISUAL_BASELINE_DIR override the defaults. It exits non-zero if any check fails.
 */
import { chromium } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = path.resolve(process.env.VISUAL_OUT_DIR ?? "scripts/visual-output");
const BASELINES = path.resolve(process.env.VISUAL_BASELINE_DIR ?? "scripts/visual-baselines");
const UPDATE_BASELINES = process.env.VISUAL_UPDATE === "1";
const EMAIL = process.env.VISUAL_EMAIL ?? "owner@appolo.test";
const PASSWORD = process.env.VISUAL_PASSWORD ?? "appolo-demo-1234";
const MIN_SCREENSHOT_BYTES = 20_000;
// Causes the check to fail at 0.1% changed pixels, which tolerates font and
// anti-aliasing differences between machines but catches real layout changes.
const MAX_DIFF_RATIO = 0.001;

const SCREENS = [
  { name: "home", path: "/app", title: "Home", heading: "Hey, Demo" },
  { name: "rankings", path: "/app/rankings?kind=movie", title: "Rankings", heading: "Rankings" },
  { name: "profile", path: "/app/profile", title: "Profile", heading: "Demo Profile" },
  { name: "browse", path: "/app/browse", title: "Browse", heading: "Browse" },
  { name: "search", path: "/app/search", title: "Search", heading: "Search" },
  { name: "taste", path: "/app/taste", title: "Taste DNA", heading: "Taste DNA" },
];

async function compareWithBaseline(file, name) {
  const baselineFile = path.join(BASELINES, `${name}.png`);

  if (UPDATE_BASELINES) {
    await mkdir(BASELINES, { recursive: true });
    await copyFile(file, baselineFile);
    return { note: "baseline updated" };
  }

  let baseline;
  try {
    baseline = PNG.sync.read(await readFile(baselineFile));
  } catch {
    return { problem: `no baseline for ${name}; run VISUAL_UPDATE=1 pnpm visual` };
  }

  const current = PNG.sync.read(await readFile(file));
  if (current.width !== baseline.width || current.height !== baseline.height) {
    return {
      problem: `size ${current.width}x${current.height} does not match baseline ${baseline.width}x${baseline.height}`,
    };
  }

  const diff = new PNG({ width: current.width, height: current.height });
  const changed = pixelmatch(current.data, baseline.data, diff.data, current.width, current.height, {
    threshold: 0.2,
  });
  if (changed === 0) return { note: "0 px diff" };

  const diffFile = path.join(OUT, `${name}.diff.png`);
  await writeFile(diffFile, PNG.sync.write(diff));
  const ratio = changed / (current.width * current.height);
  const note = `${changed} px differ (${(ratio * 100).toFixed(2)}%) -> ${path.relative(process.cwd(), diffFile)}`;
  return ratio > MAX_DIFF_RATIO ? { problem: `differs from baseline: ${note}` } : { note };
}

await mkdir(OUT, { recursive: true });

// The headless shell keeps the browser download small; nothing here needs a
// headed browser or the full Chromium build.
const browser = await chromium.launch({ channel: "chromium-headless-shell" });
const failures = [];

try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "dark",
    deviceScaleFactor: 1,
  });

  // context.request shares its cookie jar with the pages, so this session is
  // already signed in when the first screen loads.
  const login = await context.request.post(`${BASE}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!login.ok()) {
    throw new Error(`demo login failed with ${login.status()}: ${(await login.text()).slice(0, 160)}`);
  }

  const page = await context.newPage();
  let pageErrors = [];
  let consoleErrors = [];
  let serverErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });

  for (const screen of SCREENS) {
    pageErrors = [];
    consoleErrors = [];
    serverErrors = [];
    const problems = [];
    const main = page.locator("main").first();
    let response = null;

    try {
      response = await page.goto(`${BASE}${screen.path}`, { waitUntil: "networkidle", timeout: 45_000 });
      await main.waitFor({ state: "visible", timeout: 15_000 });
      await main
        .getByRole("heading", { level: 1, name: screen.heading })
        .waitFor({ state: "visible", timeout: 20_000 });
    } catch (error) {
      problems.push(error instanceof Error ? error.message.split("\n")[0] : String(error));
    }

    const file = path.join(OUT, `${screen.name}.png`);
    let pixelNote = "";
    let saved = false;
    try {
      await page.screenshot({ path: file, animations: "disabled" });
      saved = true;
      const size = (await stat(file)).size;
      if (size < MIN_SCREENSHOT_BYTES) problems.push(`screenshot looks blank (${size} bytes)`);
    } catch (error) {
      problems.push(`screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (saved) {
      try {
        const comparison = await compareWithBaseline(file, screen.name);
        if (comparison.problem) problems.push(comparison.problem);
        pixelNote = comparison.note ?? "";
      } catch (error) {
        problems.push(`baseline comparison failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (!response || !response.ok()) problems.push(`page returned ${response?.status() ?? "no response"}`);
    const title = await page.title().catch(() => "");
    if (!title.includes(screen.title)) problems.push(`title "${title}" does not include "${screen.title}"`);
    const markup = (await main.textContent().catch(() => "")) ?? "";
    if (markup.trim().length < 40) problems.push("main content looks empty");
    if (pageErrors.length > 0) problems.push(`page errors: ${pageErrors.join(" | ")}`);
    if (consoleErrors.length > 0) problems.push(`console errors: ${consoleErrors.join(" | ")}`);
    if (serverErrors.length > 0) problems.push(`server errors: ${serverErrors.join(" | ")}`);

    if (problems.length === 0) {
      const suffix = pixelNote ? ` [${pixelNote}]` : "";
      console.log(`PASS  ${screen.name} (${screen.path}) -> ${path.relative(process.cwd(), file)}${suffix}`);
    } else {
      failures.push({ name: screen.name, problems });
      console.log(`FAIL  ${screen.name} (${screen.path})\n      ${problems.join("\n      ")}`);
    }
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.log(`\n${SCREENS.length - failures.length} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`\n${SCREENS.length} passed, 0 failed`);
