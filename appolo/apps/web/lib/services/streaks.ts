import { eq, sql } from "drizzle-orm";
import { withOrg, schema } from "@/lib/db";

const { ratingEvents } = schema;

export interface Streak {
  /** Consecutive UTC days with activity, ending today or yesterday. */
  current: number;
  longest: number;
  activeToday: boolean;
}

const DAY_MS = 86_400_000;

/** Pure helper. `days` are days since the epoch (UTC), newest first, no duplicates. */
export function streakFromDays(days: readonly number[], today: number): Streak {
  let current = 0;
  if (days.length > 0 && days[0]! >= today - 1) {
    current = 1;
    for (let i = 1; i < days.length; i += 1) {
      if (days[i - 1]! - days[i]! === 1) current += 1;
      else break;
    }
  }
  let longest = 0;
  let run = 0;
  for (let i = 0; i < days.length; i += 1) {
    run = i > 0 && days[i - 1]! - days[i]! === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return { current, longest, activeToday: days[0] === today };
}

/** Activity streak built from the History timeline (votes, manual scores, reviews). */
export async function ratingStreak(orgId: string): Promise<Streak> {
  const day = sql<string>`to_char(${ratingEvents.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const rows = await withOrg(orgId, (tx) =>
    tx
      .select({ day })
      .from(ratingEvents)
      .where(eq(ratingEvents.orgId, orgId))
      .groupBy(day)
      .orderBy(sql`${day} desc`)
      .limit(400),
  );
  const days = rows.map((row) => Math.floor(Date.parse(`${row.day}T00:00:00Z`) / DAY_MS));
  return streakFromDays(days, Math.floor(Date.now() / DAY_MS));
}
