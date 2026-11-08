import { requireSession } from "@/lib/session";
import { BottomNav } from "@/components/bottom-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();

  return (
    <div className="min-h-screen bg-black">
      <div className="relative mx-auto flex min-h-screen w-full max-w-[560px] flex-col border-x border-white/[0.04] bg-black">
        <main className="flex-1 pb-28">{children}</main>
        <BottomNav />
      </div>
    </div>
  );
}