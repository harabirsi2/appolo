import { requireSession } from "@/lib/session";
import { getCatalogItem } from "@/lib/services/rankings";
import { BackButton } from "@/components/back-button";
import { CreatePodForm } from "@/components/create-pod-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New pod" };

export default async function NewPodPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  await requireSession();
  const { item: itemId } = await searchParams;
  const item = itemId ? await getCatalogItem(itemId) : null;

  return (
    <div className="px-5 pt-4">
      <div className="flex items-center justify-between">
        <BackButton fallback="/app" />
        <span className="text-xs text-muted-2">Shareable list</span>
      </div>
      <h1 className="mt-4 text-[30px] font-extrabold tracking-tight text-ink">New pod</h1>
      <p className="mt-1 text-[13px] text-muted">
        Group anything — a top five, a mood, a year in review — and share the link.
      </p>
      <CreatePodForm
        initialItem={item ? { id: item.id, title: item.title, kind: item.kind } : null}
      />
    </div>
  );
}