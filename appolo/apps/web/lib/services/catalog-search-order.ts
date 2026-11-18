import { sql } from "drizzle-orm";
import { schema } from "@/lib/db";

const { title, subtitle, id } = schema.catalogItems;

/**
 * Shared eligibility and ordering for catalog search.
 *
 * Substring matching decides which rows are eligible; relevance decides their
 * order: exact title, title prefix, subtitle prefix, then pg_trgm similarity,
 * with title and id as deterministic tie-breaks. The pattern is escaped, so a
 * user-typed `%`, `_` or `\` matches literally instead of widening the scan.
 */
export function catalogQueryClauses(query: string) {
  if (!query) return { filter: undefined, order: [title, id] };
  const pattern = query.replace(/[\\%_]/g, (character) => `\\${character}`);
  const contains = `%${pattern}%`;
  return {
    filter: sql`(${title} ilike ${contains} or ${subtitle} ilike ${contains})`,
    order: [
      sql`case
        when lower(${title}) = lower(${query}) then 3
        when ${title} ilike ${`${pattern}%`} then 2
        when ${subtitle} ilike ${`${pattern}%`} then 1
        else 0
      end desc`,
      sql`greatest(similarity(${title}, ${query}), coalesce(similarity(${subtitle}, ${query}), 0)) desc`,
      title,
      id,
    ],
  };
}
