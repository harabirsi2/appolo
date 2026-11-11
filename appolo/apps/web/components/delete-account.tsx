"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Password-confirmed account deletion. A session cookie alone must not be
 * enough to erase a workspace, and the typed phrase guards against a stray
 * click on a destructive control.
 */
export function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Could not delete the account.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error — the account was not deleted.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger hover:bg-danger/15"
      >
        Delete my account
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-danger/30 bg-danger/[0.06] p-3">
      <p className="text-sm text-ink">
        This deletes your account and workspace, including ratings, matchups, reviews, watchlist, pods and
        your saved ranking order. It cannot be undone.
      </p>
      <label className="block text-xs text-muted">
        Password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink"
        />
      </label>
      <label className="block text-xs text-muted">
        Type DELETE to confirm
        <input
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink"
        />
      </label>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={remove}
          disabled={busy || confirm !== "DELETE" || password.length === 0}
          className="rounded-lg bg-danger px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? "Deleting…" : "Permanently delete"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPassword("");
            setConfirm("");
            setError(null);
          }}
          disabled={busy}
          className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
