"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/podiums";

/**
 * The push permission ask.
 *
 * The rules this copy follows, because a browser prompt shown at the wrong
 * moment is a permanent "blocked" (there is no second chance — the site cannot
 * re-prompt after a denial):
 *
 *  - it appears after the person has saved a first rating, never on arrival;
 *  - it says exactly what will be sent and how often, so the expectation is set
 *    before the OS dialog appears;
 *  - "Not now" is a real option that snoozes for two weeks instead of nagging;
 *  - on iOS it explains the Home Screen requirement up front, because Safari
 *    only exposes notifications to installed web apps and a rejected prompt
 *    there is also permanent.
 */
const SNOOZE_KEY = "appolo:push-snooze";
const SNOOZE_DAYS = 14;

type Status = "hidden" | "ask" | "ios-install" | "working" | "done" | "unconfigured" | "error";

/** The VAPID key arrives base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function PushOptIn() {
  const [status, setStatus] = useState<Status>("hidden");

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (!("Notification" in window)) return;

    const snoozedAt = Number(window.localStorage.getItem(SNOOZE_KEY) ?? 0);
    if (snoozedAt && Date.now() - snoozedAt < SNOOZE_DAYS * 86_400_000) return;
    if (Notification.permission === "denied") return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIos && !standalone) {
      setStatus("ios-install");
      return;
    }

    if (Notification.permission === "granted") {
      void navigator.serviceWorker.ready
        .then((registration) => registration.pushManager?.getSubscription())
        .then((existing) => setStatus(existing ? "hidden" : "ask"))
        .catch(() => setStatus("ask"));
      return;
    }

    setStatus("ask");
  }, []);

  async function enable() {
    setStatus("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("hidden");
        return;
      }
      const response = await fetch("/api/push/subscribe", { cache: "no-store" });
      const { key } = (await response.json()) as { key: string | null };
      if (!key) {
        setStatus("unconfigured");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const saved = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription),
      });
      setStatus(saved.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  }

  function snooze() {
    window.localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    setStatus("hidden");
  }

  if (status === "hidden" || status === "working") return null;

  return (
    <section
      aria-labelledby="push-heading"
      className="rounded-2xl border border-border bg-surface p-4"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-full bg-brand/10 p-2 text-brand" aria-hidden>
          <Icon name="bell" className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 id="push-heading" className="text-sm font-semibold text-ink">
            {status === "done"
              ? "Notifications are on"
              : status === "ios-install"
                ? "Add Appolo to your Home Screen first"
                : "Know when your friends rank something"}
          </h2>

          {status === "ask" && (
            <>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                One notification when someone you follow finishes a comparison, plus a short
                weekly recap. No daily pings, no marketing, off in one tap.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void enable()}
                  className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black"
                >
                  Turn on notifications
                </button>
                <button
                  type="button"
                  onClick={snooze}
                  className="rounded-full border border-border px-4 py-2 text-sm font-medium text-muted"
                >
                  Not now
                </button>
              </div>
            </>
          )}

          {status === "ios-install" && (
            <p className="mt-1 text-sm leading-relaxed text-muted">
              iPhone only allows notifications for apps on the Home Screen. Tap Share, then{" "}
              <span className="text-ink">Add to Home Screen</span>, open Appolo from there, and
              this switch appears.
            </p>
          )}

          {status === "done" && (
            <p className="mt-1 text-sm leading-relaxed text-muted">
              You&apos;ll hear from us when someone you follow compares something. You can turn
              this off any time in Settings.
            </p>
          )}

          {status === "unconfigured" && (
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Notifications are not configured on this deployment yet.
            </p>
          )}

          {status === "error" && (
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Could not save the subscription. Try again from Settings later.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
