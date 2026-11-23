"use client";

import { useState } from "react";
import type { ProfileSummary } from "@/lib/services/social";

export interface ReviewChoice {
  ratingId: string;
  title: string;
  text: string | null;
  tags: string[];
}

export function ProfileSettings({
  profile,
  reviews,
}: {
  profile: ProfileSummary;
  reviews: ReviewChoice[];
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [avatarHue, setAvatarHue] = useState(profile.avatarHue);
  const [manualMode, setManualMode] = useState(profile.manualMode);
  const [profileLayout, setProfileLayout] = useState<"list" | "grid">(profile.profileLayout);
  const [pinnedId, setPinnedId] = useState<string | null>(profile.pinnedRatingId);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pinning, setPinning] = useState(false);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          username,
          bio,
          avatarHue,
          manualMode,
          profileLayout,
        }),
      });
      setStatus(res.ok ? "Saved" : "Could not save");
    } catch {
      setStatus("Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function pinRating(ratingId: string | null) {
    setPinning(true);
    setStatus(null);
    try {
      const res = await fetch("/api/profile/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratingId }),
      });
      if (!res.ok) {
        setStatus("Could not update the pinned review");
        return;
      }
      const data = (await res.json()) as { profile?: { pinnedRatingId?: string | null } };
      setPinnedId(data.profile?.pinnedRatingId ?? null);
      setStatus(ratingId ? "Review pinned" : "Review unpinned");
    } catch {
      setStatus("Could not update the pinned review");
    } finally {
      setPinning(false);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="space-y-3">
        <label className="block text-[12px] text-muted-2">Display name</label>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="h-11 w-full rounded-xl border border-white/[0.06] bg-[#1a1a1d] px-3 text-[14px] text-ink focus:border-white/20 focus:outline-none" />
      </div>
      <div className="space-y-3">
        <label className="block text-[12px] text-muted-2">Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} className="h-11 w-full rounded-xl border border-white/[0.06] bg-[#1a1a1d] px-3 text-[14px] text-ink focus:border-white/20 focus:outline-none" />
      </div>
      <div className="space-y-3">
        <label className="block text-[12px] text-muted-2">Bio</label>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className="w-full rounded-xl border border-white/[0.06] bg-[#1a1a1d] px-3 py-2 text-[14px] text-ink focus:border-white/20 focus:outline-none" />
      </div>
      <div className="space-y-3">
        <label className="block text-[12px] text-muted-2">Avatar hue</label>
        <input type="range" min={0} max={360} value={avatarHue} onChange={(e) => setAvatarHue(Number(e.target.value))} className="w-full" />
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 space-y-3">
        <h3 className="text-[14px] font-semibold text-ink">Preferences</h3>
        <label className="flex items-center justify-between text-[13px] text-ink">
          Manual mode (set exact scores)
          <input type="checkbox" checked={manualMode} onChange={(e) => setManualMode(e.target.checked)} />
        </label>
        <div className="space-y-1">
          <label className="block text-[12px] text-muted-2">Profile layout</label>
          <select value={profileLayout} onChange={(e) => setProfileLayout(e.target.value as "list" | "grid")} className="h-10 w-full rounded-xl border border-white/[0.06] bg-[#1a1a1d] px-3 text-[14px] text-ink">
            <option value="list">List</option>
            <option value="grid">Grid</option>
          </select>
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 space-y-3">
        <div>
          <h3 className="text-[14px] font-semibold text-ink">Spotify import</h3>
          <p className="mt-1 text-[12px] text-muted-2">
            {profile.spotifyConnected
              ? "Spotify OAuth completed. Reconnect to authorize another import of your top tracks."
              : "Not connected. Connect Spotify to import your top tracks as unrated watchlist items."}
          </p>
        </div>
        <a
          href="/api/spotify/connect"
          className="inline-flex rounded-full border border-white/10 px-3 py-1.5 text-[12px] text-ink hover:border-white/20"
        >
          {profile.spotifyConnected ? "Reconnect Spotify" : "Connect Spotify"}
        </a>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-full bg-white px-5 py-2 text-[13px] font-semibold text-black disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save profile"}
      </button>
      {status ? <p aria-live="polite" className="text-[12px] text-muted-2">{status}</p> : null}

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
        <h3 className="text-[14px] font-semibold text-ink">Pinned review</h3>
        <p className="mt-1 text-[12px] text-muted-2">
          Choose one of your written reviews to show at the top of your profile.
        </p>
        {reviews.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-white/10 p-3 text-[12px] text-muted-2">
            You have not written a review yet. Write one from an item page, then come back here to pin it.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-white/[0.06]">
            {reviews.map((review) => {
              const pinned = pinnedId === review.ratingId;
              return (
                <li key={review.ratingId} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{review.title}</p>
                    <p className="truncate text-[11px] text-muted-2">
                      {review.text ?? review.tags.join(" · ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => pinRating(pinned ? null : review.ratingId)}
                    disabled={pinning}
                    aria-pressed={pinned}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] disabled:opacity-60 ${
                      pinned
                        ? "border-brand/40 bg-brand/15 text-brand"
                        : "border-white/10 text-muted hover:text-ink"
                    }`}
                  >
                    {pinned ? "Pinned" : "Pin"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {pinnedId ? (
          <button
            type="button"
            onClick={() => pinRating(null)}
            disabled={pinning}
            className="mt-3 rounded-full border border-white/10 px-3 py-1.5 text-[12px] text-muted hover:text-ink disabled:opacity-60"
          >
            Unpin current review
          </button>
        ) : null}
      </div>
    </div>
  );
}
