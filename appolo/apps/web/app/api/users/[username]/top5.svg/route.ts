import { topFive } from "@/lib/services/rankings";
import { getProfileByUsername } from "@/lib/services/social-graph";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ username: string }> };

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return escapeXml(text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
}

/**
 * A plain SVG podium card, embeddable anywhere an `<img>` works:
 *
 *   /api/users/ava/top5.svg
 *
 * Unlike the PNG cards this is text-first, so it stays tiny and readable in a
 * README or profile page.
 */
export async function GET(_request: Request, { params }: Params) {
  const { username } = await params;
  const profile = await getProfileByUsername(decodeURIComponent(username));
  if (!profile) return new Response("Not found", { status: 404 });

  const items = await topFive(profile.orgId);
  const rows = items
    .map((item, index) => {
      const y = 250 + index * 66;
      const accent = index === 0 ? "#10B981" : "#3f3f46";
      const rankFill = index === 0 ? "#10B981" : "#27272a";
      const rankText = index === 0 ? "#06210f" : "#f4f4f5";
      const meta = [item.subtitle, item.year ? String(item.year) : null].filter(Boolean).join(" · ");
      return `
    <g>
      <rect x="72" y="${y - 24}" width="1056" height="54" rx="14" fill="${index === 0 ? "#12301f" : "#141416"}" stroke="${accent}" stroke-opacity="${index === 0 ? 0.6 : 0.18}" />
      <rect x="88" y="${y - 14}" width="34" height="34" rx="9" fill="${rankFill}" />
      <text x="105" y="${y + 8}" text-anchor="middle" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="${rankText}">${index + 1}</text>
      <text x="140" y="${y + 2}" font-family="Arial, sans-serif" font-size="21" font-weight="700" fill="#f4f4f5">${clip(item.title, 44)}</text>
      <text x="140" y="${y + 21}" font-family="Arial, sans-serif" font-size="13" fill="#a1a1aa">${clip(meta, 56)}</text>
      <text x="1108" y="${y + 10}" text-anchor="end" font-family="Arial, sans-serif" font-size="26" font-weight="800" fill="#10B981">${item.score.toFixed(1)}</text>
    </g>`;
    })
    .join("");

  const empty = `<text x="600" y="330" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#a1a1aa">No ranked titles yet.</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${clip(`${profile.displayName}'s top five`, 80)}">
  <defs>
    <radialGradient id="glow" cx="18%" cy="6%" r="60%">
      <stop offset="0%" stop-color="#10B981" stop-opacity="0.24" />
      <stop offset="100%" stop-color="#10B981" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#0b0b0d" />
  <rect width="1200" height="630" fill="url(#glow)" />
  <rect x="72" y="70" width="44" height="44" rx="12" fill="#10B981" />
  <text x="94" y="101" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="900" fill="#06210f">A</text>
  <text x="132" y="99" font-family="Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="4" fill="#a1a1aa">PODIUM</text>
  <text x="72" y="176" font-family="Arial, sans-serif" font-size="46" font-weight="800" fill="#f4f4f5">${clip(profile.displayName, 34)}</text>
  <text x="72" y="208" font-family="Arial, sans-serif" font-size="22" fill="#a1a1aa">@${clip(profile.username, 34)}</text>
  ${items.length > 0 ? rows : empty}
  <text x="72" y="600" font-family="Arial, sans-serif" font-size="16" fill="#71717a">appolo</text>
  <text x="1128" y="600" text-anchor="end" font-family="Arial, sans-serif" font-size="16" fill="#71717a">Rank what you love</text>
</svg>`;

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
