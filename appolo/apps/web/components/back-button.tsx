"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/podiums";

export function BackButton({ fallback = "/app" }: { fallback?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Back"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
      className="grid h-9 w-9 place-items-center rounded-full bg-black/40 text-ink backdrop-blur transition-colors hover:bg-black/60"
    >
      <Icon name="back" className="h-5 w-5" />
    </button>
  );
}