import { requireSession } from "@/lib/session";
import { BottomNav } from "@/components/bottom-nav";
import { DesktopNav } from "@/components/desktop-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();

  return (
    <div className="relative min-h-screen bg-black">
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[380px]"
        style={{
          background:
            "radial-gradient(70% 60% at 50% 0%, rgba(74,222,128,0.10), transparent 70%), radial-gradient(40% 40% at 85% 10%, rgba(96,165,250,0.06), transparent 70%)",
        }}
        aria-hidden
      />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[560px] flex-col border-x border-white/[0.05] bg-black/95 shadow-float lg:max-w-[1000px] lg:flex-row">
        <DesktopNav />
        <div className="flex min-h-screen w-full min-w-0 flex-1 flex-col lg:max-w-[768px]">
          <main className="flex-1 pb-28 lg:pb-16">{children}</main>
          <BottomNav />
        </div>
      </div>
    </div>
  );
}