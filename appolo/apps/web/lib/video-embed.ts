export type VideoEmbed = { kind: "iframe" | "video"; src: string };

const ID = /^[\w-]{6,20}$/;

/** Turn a review video link into something safe to render. Unknown hosts fall back to <video>. */
export function videoEmbed(url: string): VideoEmbed {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
    const youtube =
      host === "youtu.be" ? u.pathname.slice(1) : host === "youtube.com" ? (u.searchParams.get("v") ?? "") : "";
    if (ID.test(youtube)) return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${youtube}` };
    const vimeo = host === "vimeo.com" ? (u.pathname.split("/").filter(Boolean)[0] ?? "") : "";
    if (/^\d+$/.test(vimeo)) return { kind: "iframe", src: `https://player.vimeo.com/video/${vimeo}` };
  } catch {
    // fall through to a plain <video>
  }
  return { kind: "video", src: url };
}
