/**
 * Provider attribution.
 *
 * Every catalogue provider we read from has a terms clause that requires credit
 * where the data is shown, and the wording is not ours to improve:
 *
 *  - TMDB requires the sentence "This product uses the TMDB API but is not
 *    endorsed or certified by TMDB." and their mark, on every surface that
 *    displays TMDB data.
 *  - iTunes/Apple Search API asks for "Data provided by Apple" with a link, and
 *    forbids implying endorsement.
 *  - Open Library data is CC0 but the covers are not; credit and a link is the
 *    safe reading of their terms.
 *  - RAWG requires "Powered by RAWG" with a link.
 *
 * The link text is the provider name, so the credit survives with images
 * blocked, in a screen reader, and in a text-only export. See
 * docs/PROVIDER-TERMS.md for the clause-by-clause checklist.
 */

type Provider = "tmdb" | "itunes" | "openlibrary" | "rawg";

const PROVIDERS: Record<Provider, { label: string; href: string; note: string }> = {
  tmdb: {
    label: "TMDB",
    href: "https://www.themoviedb.org/",
    note: "This product uses the TMDB API but is not endorsed or certified by TMDB.",
  },
  itunes: {
    label: "Apple",
    href: "https://www.apple.com/itunes/",
    note: "Data provided by Apple.",
  },
  openlibrary: {
    label: "Open Library",
    href: "https://openlibrary.org/",
    note: "Bibliographic data from Open Library.",
  },
  rawg: {
    label: "RAWG",
    href: "https://rawg.io/",
    note: "Powered by RAWG.",
  },
};

function isProvider(value: string | null | undefined): value is Provider {
  return value === "tmdb" || value === "itunes" || value === "openlibrary" || value === "rawg";
}

export function DataAttribution({ source, className = "" }: { source: string | null; className?: string }) {
  // Manually entered items carry no third-party data, so they need no credit.
  if (!isProvider(source)) return null;
  const provider = PROVIDERS[source];

  return (
    <p className={`text-[11px] leading-relaxed text-muted-2 ${className}`.trim()}>
      {provider.note}{" "}
      <a
        href={provider.href}
        target="_blank"
        rel="noreferrer noopener"
        className="underline decoration-white/25 underline-offset-2 hover:text-ink"
      >
        {provider.label}
      </a>
    </p>
  );
}
