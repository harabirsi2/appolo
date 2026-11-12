#!/usr/bin/env node
/**
 * Browser-driven visual checks for the main Appolo screens.
 *
 * Starts a real Chromium, signs in with the seeded demo account, visits each
 * main screen, and fails on page errors, console errors, 5xx responses, a
 * wrong title, empty content or a blank screenshot. Every screen is saved as
 * a viewport PNG under scripts/visual-output/ for human review.
 *
 * Usage:
 *   pnpm exec playwright install chromium
 *   pnpm dev       # in one terminal
 *   pnpm visual    # in another
 *
 * BASE_URL, VISUAL_EMAIL, VISUAL_PASSWORD and VISUAL_OUT_DIR override the
 * defaults. It exits non-zero if any check fails.
 */
import { chromium } from "playwright";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = path.resolve(process.env.VISUAL_OUT_DIR ?? "scripts/visual-output");
const EMAIL = process.env.VISUAL_EMAIL ?? "owner@appolo.test";
const PASSWORD = process.env.VISUAL_PASSWORD ?? "appolo-demo-1234";
const SESSION_COOKIE = "appolo_session";
const MIN_SCREENSHOT_BYTES = 20_000;

const SCREENS = [
  { name: "home", path: "/app", title: "Home", heading: "Hey, Demo" },
  { name: "rankings", path: "/app/rankings?kind=movie", title: "Rankings", heading: "Rankings" },
  { name: "profile", path: "/app/profile", title: "Profile", heading: "Demo Profile" },
  { name: "browse", path: "/app/browse", title: "Browse", heading: "Browse" },
  { name: "search", path: "/app/search", title: "Search", heading: "Search" },
  { name: "taste", path: "/app/taste", title: "Taste DNA", heading: "Taste DNA" },
];

async function signIn() {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`demo login failed with ${response.status}: ${(await response.text()).slice(0, 160)}`);
  }
  const cookies = response.headers.getSetCookie?.() ?? [];
  const session = cookies.map((value) => value.split(";")[0]).find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  if (!session) throw new Error("demo login did not set the session cookie");
  return { name: SESSION_COOKIE, value: session.slice(SESSION_COOKIE.length + 1), url: BASE };
}

async function waitForHeading(page, heading) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const text = await page.locator("main h1:visible").first().textContent().catch(() => "");
    if (text?.includes(heading)) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

await mkdir(OUT, { recursive: true });
const failures = [];
const browser = await chromium.launch({ channel: "chromium-headless-shell" });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "dark",
    deviceScaleFactor: 1,
  });
  await context.addCookies([await signIn()]);
  const page = await context.newPage();
  let pageErrors = [];
  let consoleErrors = [];
  let serverErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Download the React DevTools")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });

  for (const screen of SCREENS) {
    pageErrors = [];
    consoleErrors = [];
    serverErrors = [];
    const problems = [];
    let response = null;
    try {
      response = await page.goto(`${BASE}${screen.path}`, { waitUntil: "networkidle", timeout: 45_000 });
      await page.locator("main").first().waitFor({ state: "visible", timeout: 15_000 });
      if (!(await waitForHeading(page, screen.heading))) problems.push(`heading "${screen.heading}" did not render`);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }

    const file = path.join(OUT, `${screen.name}.png`);
    try {
      await page.screenshot({ path: file, fullPage: false, animations: "disabled" });
      const size = (await stat(file)).size;
      if (size < MIN_SCREENSHOT_BYTES) problems.push(`screenshot looks blank (${size} bytes)`);
    } catch (error) {
      problems.push(`screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response || !response.ok()) problems.push(`page returned ${response?.status() ?? "no response"}`);
    const title = await page.title().catch(() => "");
    if (!title.includes(screen.title)) problems.push(`title "${title}" does not include "${screen.title}"`);
    const markup = (await page.locator("main").first().textContent().catch(() => "")) ?? "";
    if (markup.trim().length < 40) problems.push("main content looks empty");
    if (pageErrors.length > 0) problems.push(`page errors: ${pageErrors.join(" | ")}`);
    if (consoleErrors.length > 0) problems.push(`console errors: ${consoleErrors.join(" | ")}`);
    if (serverErrors.length > 0) problems.push(`server errors: ${serverErrors.join(" | ")}`);

    if (problems.length === 0) {
      console.log(`PASS  ${screen.name} (${screen.path}) -> ${path.relative(process.cwd(), file)}`);
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
