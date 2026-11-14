import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { personBySlug } from "@/lib/services/rankings";
import { MediaArt } from "@/components/media-art";
import { BackButton } from "@/components/back-button";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const person = await personBySlug(slug);
  return { title: person ? person.name : "Creator" };
}

/**
 * Creator / cast page. Same data as `/app/person/[slug]`; `/app/creator` is the
 * canonical name in the product spec, so it gets its own route.
 */
export default async function CreatorPage({ params }: Params) {
  await requireSession();
  const { slug } = await params;
  const person = await personBySlug(slug);
  if (!person) notFound();

  const [lead, ...rest] = person.works;

  return (
    <div className="relative px-5 pt-4 pb-24">
      <div className="flex items-center justify-between">
        <BackButton fallback="/app/search" />
      </div>

      <h1 className="mt-6 text-[28px] font-bold tracking-tight text-ink">{person.name}</h1>
      <p className="mt-1 text-[13px] capitalize text-muted-2">{person.roles.join(" · ")}</p>
      <p className="mt-1 text-[11px] text-muted-2">
        {person.works.length} {person.works.length === 1 ? "title" : "titles"} in the catalog
      </p>

      {lead ? (
        <Link
          href={`/app/item/${lead.id}`}
          className="mt-5 block overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.04] transition-transform active:scale-[0.99]"
        >
          <MediaArt
            kind={lead.kind}
            title={lead.title}
            imageUrl={lead.imageUrl}
            genres={lead.genres}
            sizes="(max-width: 768px) 100vw, 728px"
            className="aspect-[16/9] w-full"
          />
          <div className="p-3">
            <p className="truncate text-[15px] font-semibold text-ink">{lead.title}</p>
            <p className="truncate text-[12px] text-muted-2">
              {[lead.subtitle, lead.year ? String(lead.year) : null].filter(Boolean).join(" · ")}
            </p>
          </div>
        </Link>
      ) : null}

      {rest.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-[15px] font-semibold text-ink">Also known for</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {rest.map((item) => (
              <Link
                key={item.id}
                href={`/app/item/${item.id}`}
                className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.04] transition-transform active:scale-[0.99]"
              >
                <MediaArt
                  kind={item.kind}
                  title={item.title}
                  imageUrl={item.imageUrl}
                  sizes="(max-width: 768px) 50vw, 360px"
                  className="aspect-[2/3] w-full"
                />
                <div className="p-2.5">
                  <p className="truncate text-[13px] font-medium text-ink">{item.title}</p>
                  <p className="truncate text-[11px] text-muted-2">{item.subtitle}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
