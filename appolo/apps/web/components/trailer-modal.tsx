"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Trailer playback in a modal.
 *
 * The iframe is only mounted while the dialog is open, so the page does not
 * pay for a third-party embed until the viewer asks for it. Escape closes the
 * dialog and focus returns to the trigger.
 */
export function TrailerModal({
  embedUrl,
  title,
  label = "Watch trailer",
  className,
}: {
  embedUrl: string;
  title: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "inline-flex items-center gap-2 text-[13px] font-medium text-ink transition-colors hover:text-brand"
        }
      >
        <span className="grid h-6 w-6 place-items-center rounded-full border border-white/25 bg-white/10 text-[10px]">▶</span>
        {label}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${title} trailer`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
        >
          {/* Backdrop dismissal is a real button, not a div with a handler:
              focusable, announced, and it cannot swallow the panel's clicks. */}
          <button
            type="button"
            aria-label="Close trailer"
            className="absolute inset-0 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="relative w-full max-w-3xl">
            <div className="mb-2 flex items-center justify-between">
              <p className="truncate pr-3 text-[13px] font-semibold text-white">{title} — trailer</p>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] text-white hover:bg-white/20"
              >
                Close
              </button>
            </div>
            <div className="aspect-video w-full overflow-hidden rounded-xl border border-white/15 bg-black">
              <iframe
                src={embedUrl}
                title={`${title} trailer`}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}