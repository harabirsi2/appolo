"use client";

import { useState } from "react";
import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  type ReportContentType,
  type ReportReason,
} from "@/lib/moderation-constants";

/**
 * Small inline reporting control. It intentionally stays in the page instead
 * of opening a modal so a report can be filed without losing reading position.
 */
export function ReportButton({
  contentType,
  contentId,
  label = "Report",
}: {
  contentType: ReportContentType;
  contentId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("spam");
  const [details, setDetails] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/reports/abuse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentType,
          contentId,
          reason,
          details: details.trim() || null,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; created?: boolean };
      if (!response.ok) {
        setMessage(data.error ?? "Could not send that report.");
        return;
      }
      setDone(true);
      setMessage(data.created === false ? "You already reported this." : "Thanks — a moderator will review it.");
      setDetails("");
    } catch {
      setMessage("Could not send that report. Check your connection.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-muted-2 hover:text-danger"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3">
      <p className="text-[11px] font-medium text-ink">Report this content</p>
      {done ? (
        <p className="mt-2 text-[11px] text-muted" role="status">
          {message}
        </p>
      ) : (
        <>
          <label className="mt-2 block text-[10px] uppercase tracking-wide text-muted-2" htmlFor={`report-reason-${contentId}`}>
            Reason
          </label>
          <select
            id={`report-reason-${contentId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value as ReportReason)}
            className="mt-1 h-8 w-full rounded-lg border border-white/10 bg-[#1a1a1d] px-2 text-[12px] text-ink focus:border-white/25 focus:outline-none"
          >
            {REPORT_REASONS.map((value) => (
              <option key={value} value={value}>
                {REPORT_REASON_LABELS[value]}
              </option>
            ))}
          </select>
          <label className="mt-2 block text-[10px] uppercase tracking-wide text-muted-2" htmlFor={`report-details-${contentId}`}>
            Details <span className="normal-case tracking-normal">(optional)</span>
          </label>
          <textarea
            id={`report-details-${contentId}`}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            maxLength={1000}
            rows={2}
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#1a1a1d] px-2 py-1.5 text-[12px] text-ink focus:border-white/25 focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-black disabled:opacity-60"
            >
              {pending ? "Sending…" : "Send report"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setMessage(null);
              }}
              className="text-[11px] text-muted-2 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </>
      )}
      {message && !done ? (
        <p className="mt-2 text-[11px] text-danger" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
