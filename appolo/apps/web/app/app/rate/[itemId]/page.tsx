import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, EmptyState } from "@appolo/ui";
import { requireSession } from "@/lib/session";
import { getCatalogItem, nextMatchup } from "@/lib/services/rankings";
import { isDomainError } from "@/lib/services/errors";
import { RateGame } from "./rate-game";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rate" };

type Params = { params: Promise<{ itemId: string }> };

export default async function RateItemPage({ params }: Params) {
  const session = await requireSession();
  const { itemId } = await params;

  const item = await getCatalogItem(itemId);
  if (!item) notFound();

  let matchup: Awaited<ReturnType<typeof nextMatchup>> | null = null;
  let reason = "";
  try {
    matchup = await nextMatchup(session.org.id, itemId);
  } catch (error) {
    if (isDomainError(error) && error.code === "NO_OPPONENT") {
      reason = error.message;
    } else {
      throw error;
    }
  }

  if (!matchup) {
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState
          title="No opponents available"
          body={reason || "Add more items to the catalog before ranking this one."}
          action={
            <Link href="/app/rate">
              <Button size="sm" variant="secondary">Back to catalog</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return <RateGame initialItem={matchup.item} initialOpponent={matchup.opponent} />;
}

function BackLink() {
  return (
    <Link href="/app/rate" className="text-xs text-muted hover:text-ink">
      ← All items
    </Link>
  );
}