#!/usr/bin/env node
/**
 * Guard against the cover-art fallback regression: a MediaArt call site that
 * has a catalog item (and therefore an imageUrl) but forgets to pass it renders
 * generic generated art instead of the real cover.
 *
 * Every call site must name the prop explicitly — `imageUrl={item.imageUrl}`
 * for real items, or `imageUrl={null}` for the decorative tiles that genuinely
 * have no cover. A missing prop cannot be distinguished from an accidental
 * omission by typechecking, because it is optional on the component.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.env.MEDIA_ART_ROOT ?? "apps/web");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build"]);

async function tsxFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await tsxFiles(full)));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Text from after `<MediaArt` to the end of its opening tag. */
function openingTags(source, file) {
  const tags = [];
  const marker = /<MediaArt\b/g;
  let match;
  while ((match = marker.exec(source))) {
    let i = match.index + match[0].length;
    let depth = 0;
    let quote = null;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) {
        if (ch === "\\") i += 1;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if ((ch === ">" || ch === "/") && depth === 0) {
        // `>` closes the tag; `/` is only the self-closing slash when followed by `>`.
        if (ch === ">" || source[i + 1] === ">") break;
      }
    }
    const line = source.slice(0, match.index).split("\n").length;
    tags.push({ tag: source.slice(match.index, i + 1), line, file });
  }
  return tags;
}

const problems = [];
for (const file of await tsxFiles(ROOT)) {
  const source = await readFile(file, "utf8");
  if (!source.includes("<MediaArt")) continue;
  for (const { tag, line } of openingTags(source, file)) {
    if (!/(^|\s)imageUrl\s*=/m.test(tag)) {
      problems.push(`${path.relative(process.cwd(), file)}:${line} — MediaArt call is missing imageUrl`);
    }
  }
}

if (problems.length > 0) {
  console.error("MediaArt call sites must pass imageUrl (use imageUrl={null} for decorative art):");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("MediaArt: every call site passes an explicit imageUrl.");
