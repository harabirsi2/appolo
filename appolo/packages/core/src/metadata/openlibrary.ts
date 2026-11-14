import type { MetadataAdapter, MetadataCandidate, MetadataConfig, MetadataDetails } from "./types";
import { list, requestJson, text, yearOf } from "./shared";

/**
 * Open Library adapter for books. Free, no key.
 * Covers use the `cover_i` id at the large size; author and page count are
 * included in `metadata` for the item detail page.
 */
function cover(id: unknown): string | null {
  return typeof id === "number" ? `https://covers.openlibrary.org/b/id/${id}-L.jpg` : null;
}

async function searchOpenLibrary(
  query: string,
  limit: number,
  config: MetadataConfig,
): Promise<MetadataCandidate[]> {
  const url =
    `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 20)}` +
    "&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median,publisher,subject,first_sentence";
  const data = await requestJson(url, { fetchImpl: config.fetchImpl, timeoutMs: config.timeoutMs });
  const out: MetadataCandidate[] = [];
  for (const row of list(data?.docs)) {
    const key = text(row.key, 80);
    const title = text(row.title, 200);
    if (!key || !title) continue;
    const authors = Array.isArray(row.author_name) ? (row.author_name as unknown[]) : [];
    const subjects = Array.isArray(row.subject) ? (row.subject as unknown[]) : [];
    const firstSentence = Array.isArray(row.first_sentence) ? (row.first_sentence as unknown[]) : [];
    const publishers = Array.isArray(row.publisher) ? (row.publisher as unknown[]) : [];
    const externalId = key.replace(/^\/works\//, "");
    out.push({
      kind: "book",
      title,
      subtitle: text(authors[0], 200),
      year: typeof row.first_publish_year === "number" ? row.first_publish_year : null,
      imageUrl: cover(row.cover_i),
      coverUrl: cover(row.cover_i),
      backdropUrl: null,
      description: text(firstSentence[0], 1500) || null,
      genres: subjects
        .map((subject) => text(subject, 60))
        .filter(Boolean)
        .slice(0, 6),
      trailerUrl: null,
      externalRef: `openlibrary:${externalId}`,
      externalId,
      source: "openlibrary",
      metadata: {
        authors: authors.map((author) => text(author, 120)).filter(Boolean),
        pageCount: typeof row.number_of_pages_median === "number" ? row.number_of_pages_median : null,
        publisher: text(publishers[0], 160) || null,
        key: externalId,
      },
    });
  }
  return out;
}

async function details(candidate: MetadataCandidate, config: MetadataConfig): Promise<MetadataDetails | null> {
  if (candidate.source !== "openlibrary") return null;
  const data = await requestJson(`https://openlibrary.org/works/${candidate.externalId}.json`, {
    fetchImpl: config.fetchImpl,
    timeoutMs: config.timeoutMs,
  });
  if (!data) return null;
  const description =
    typeof data.description === "string"
      ? text(data.description, 4000)
      : text((data.description as { value?: unknown } | undefined)?.value, 4000);
  return {
    description: description || candidate.description,
    metadata: {
      ...candidate.metadata,
      subjects: Array.isArray(data.subjects) ? (data.subjects as unknown[]).slice(0, 10) : [],
    },
  };
}

export function createOpenLibraryAdapter(config: MetadataConfig = {}): MetadataAdapter {
  return {
    source: "openlibrary",
    supports: (category) => category === "book",
    search: (_category, query, limit) => searchOpenLibrary(query, limit, config),
    details: (candidate) => details(candidate, config),
  };
}

export const openLibraryInternals = { cover, yearOf };