import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { podById } from "@/lib/services/social";
import { BackButton } from "@/components/back-button";
import { PodEditor } from "@/components/pod-editor";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export default async function PodEditPage({ params }: Params) {
  const session = await requireSession();
  const { id } = await params;
  const pod = await podById(id);
  if (!pod || pod.orgId !== session.org.id) notFound();

  return (
    <div className="px-5 pt-4 pb-24">
      <div className="flex items-center justify-between">
        <BackButton fallback="/app/profile" />
        <h1 className="text-[20px] font-bold text-ink">Edit pod</h1>
        <span className="w-8" />
      </div>
      <PodEditor pod={pod} />
    </div>
  );
}