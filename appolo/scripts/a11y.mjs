#!/usr/bin/env node
/**
 * Accessibility audit for the screens covered by the visual suite.
 *
 * Runs axe-core against the running app (same prerequisite as `pnpm visual`),
 * and fails on any serious or critical violation. The axe source is fetched
 * from a pinned CDN build so the check adds no runtime dependency; if the CDN
 * is unreachable the script exits 2 rather than pretending the page passed.
 *
 * Usage: pnpm a11y   (app already running at BASE_URL, default localhost:3000)
 */
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const AXE_URL = "https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js";
const EMAIL = process.env.DEMO_EMAIL ?? "owner@appolo.test";
const PASSWORD = process.env.DEMO_PASSWORD ?? "appolo-demo-1234";

const SCREENS = [
  { path: "/", auth: false, name: "landing" },
  { path: "/login", auth: false, name: "login" },
  { path: "/app", auth: true, name: "home" },
  { path: "/app/browse", auth: true, name: "browse" },
  { path: "/app/search", auth: true, name: "search" },
  { path: "/app/rankings?kind=movie", auth: true, name: "rankings" },
  { path: "/app/profile", auth: true, name: "profile" },
  { path: "/app/taste", auth: true, name: "taste" },
];

let axeSource;
try {
  const response = await fetch(AXE_URL, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`axe CDN returned ${response.status}`);
  axeSource = await response.text();
} catch (error) {
  console.error(`a11y: could not load axe-core (${error.message}).`);
  console.error("a11y: run again with network access; no result is not a pass.");
  process.exit(2);
}

const browser = await chromium.launch({ channel: "chromium-headless-shell" });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

const login = await context.request.post(`${BASE_URL}/api/auth/login`, {
  data: { email: EMAIL, password: PASSWORD },
});
if (!login.ok()) {
  console.error(`a11y: demo sign-in failed (${login.status()}); is the seed applied?`);
  await browser.close();
  process.exit(2);
}

let failures = 0;
for (const screen of SCREENS) {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}${screen.path}`, { waitUntil: "networkidle" });
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ["violations"] });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    }));
  });

  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  failures += blocking.length;
  if (blocking.length === 0) {
    console.log(`PASS  ${screen.name} (${screen.path})`);
  } else {
    console.log(`FAIL  ${screen.name} (${screen.path})`);
    for (const violation of blocking) {
      console.log(`  ${violation.impact} ${violation.id}: ${violation.help}`);
      for (const target of violation.nodes.slice(0, 5)) console.log(`    ${target}`);
    }
  }
  await page.close();
}

await browser.close();
console.log(`\n${SCREENS.length - failures >= 0 ? "" : ""}${failures === 0 ? "All screens passed" : `${failures} blocking violation(s)`}`);
process.exit(failures === 0 ? 0 : 1);
