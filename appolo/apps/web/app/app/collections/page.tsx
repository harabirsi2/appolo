import ProfilePage from "../profile/page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Collections" };

export default async function CollectionsPage() {
  return await ProfilePage({ searchParams: Promise.resolve({ tab: "pods" }) });
}
