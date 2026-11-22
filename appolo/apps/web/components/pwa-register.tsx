"use client";

import { useEffect } from "react";

/**
 * Registers the service worker once per session and keeps the outbox honest.
 *
 * The worker owns the queue; this component only nudges it when the connection
 * comes back (background sync is unavailable on iOS Safari) and re-broadcasts
 * the "votes flushed" message as a DOM event so any screen can refresh its
 * scores without importing the worker's internals.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => undefined);

    const flush = () => navigator.serviceWorker.controller?.postMessage({ type: "flush-votes" });
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "votes-flushed" && !cancelled) {
        window.dispatchEvent(new CustomEvent("appolo:votes-flushed", { detail: event.data }));
      }
    };

    window.addEventListener("online", flush);
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      cancelled = true;
      window.removeEventListener("online", flush);
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}
