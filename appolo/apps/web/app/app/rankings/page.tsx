import { RankingsScreen } from "@/components/rankings-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rankings" };

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  return await RankingsScreen({ searchParams });
}
