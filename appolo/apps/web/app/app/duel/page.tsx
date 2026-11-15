import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { nextMatchup, rankedRatings } from "@/lib/services/rankings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Duel" };

/**
 * Entry point for the comparison arena. Pick one of the user's ranked titles
 * and hand off to the existing matchup screen; fall back to the picker when
 * there is nothing to compare yet.
 */
export default async function DuelPage() {
  const session = await requireSession();
  const ratings = await rankedRatings(session.org.id).catch(() => []);

  for (const rating of ratings.slice(0, 12)) {
    const matchup = await nextMatchup(session.org.id, rating.id).catch(() => null);
    if (matchup) redirect(`/app/rate/${matchup.item.id}`);
  }

  redirect("/app/rate");
}
