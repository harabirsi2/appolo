"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Marks a conversation read once when it is opened. */
export function MarkRead({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    fetch(`/api/conversations/${conversationId}/read`, { method: "POST" })
      .then(() => router.refresh())
      .catch(() => {});
  }, [conversationId, router]);

  return null;
}