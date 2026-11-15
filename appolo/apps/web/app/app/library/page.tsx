import { RankingsScreen } from "@/components/rankings-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Library" };

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  return await RankingsScreen({ searchParams, heading: "Library", basePath: "/app/library" });
}
