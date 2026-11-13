import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { personBySlug } from "@/lib/services/rankings";
import { MediaArt, mediaHue } from "@/components/media-art";
import { BackButton } from "@/components/back-button";
import { Icon } from "@/components/podiums";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export default async function PersonPage({ params }: Params) {
  await requireSession();
  const { slug } = await params;
  const person = await personBySlug(slug);
  if (!person) notFound();

  return (
    <div className="relative px-5 pt-4 pb-24">
      <div className="flex items-center justify-between">
        <BackButton fallback="/app/search" />
      </div>
      <h1 className="mt-6 text-[28px] font-bold text-ink">{person.name}</h1>
      <p className="mt-1 text-[13px] text-muted-2">{person.roles.join(" · ")}</p>
      <p className="mt-1 text-[11px] text-muted-2">{person.works.length} titles</p>

      <section className="mt-6 grid grid-cols-2 gap-3">
        {person.works.map((item) => (
          <Link
            key={item.id}
            href={`/app/item/${item.id}`}
            className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.04] transition-transform active:scale-[0.99]"
          >
            <MediaArt kind={item.kind} title={item.title} imageUrl={item.imageUrl} sizes="(max-width: 768px) 100vw, 728px" className="aspect-[2/3] w-full" />
            <div className="p-2.5">
              <p className="truncate text-[13px] font-medium text-ink">{item.title}</p>
              <p className="truncate text-[11px] text-muted-2">{item.subtitle}</p>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}