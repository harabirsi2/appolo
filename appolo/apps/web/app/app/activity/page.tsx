import HomePage from "../page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity" };

export default async function ActivityPage() {
  return await HomePage({ searchParams: Promise.resolve({ feed: "following" }) });
}
