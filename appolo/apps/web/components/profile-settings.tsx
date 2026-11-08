"use client";

import { useState } from "react";
import type { ProfileSummary } from "@/lib/services/social";

export function ProfileSettings({ profile }: { profile: ProfileSummary }) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [avatarHue, setAvatarHue] = useState(profile.avatarHue);
  const [manualMode, setManualMode] = useState(profile.manualMode);
  const [spotifyConnected, setSpotifyConnected] = useState(profile.spotifyConnected);
  const [appleMusicConnected, setAppleMusicConnected] = useState(profile.appleMusicConnected);
  const [language, setLanguage] = useState(profile.language);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
          spotifyConnected,
          appleMusicConnected,
          language,
        }),
      });
      if (res.ok) setStatus("Saved");
      else setStatus("Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function pinRating(ratingId: string | null) {
    await fetch("/api/profile/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ratingId }),
    });
    setStatus("Pinned review updated");
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
        <label className="flex items-center justify-between text-[13px] text-ink">
          Spotify connected
          <input type="checkbox" checked={spotifyConnected} onChange={(e) => setSpotifyConnected(e.target.checked)} />
        </label>
        <label className="flex items-center justify-between text-[13px] text-ink">
          Apple Music connected
          <input type="checkbox" checked={appleMusicConnected} onChange={(e) => setAppleMusicConnected(e.target.checked)} />
        </label>
        <div className="space-y-1">
          <label className="block text-[12px] text-muted-2">Language</label>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className="h-10 w-full rounded-xl border border-white/[0.06] bg-[#1a1a1d] px-3 text-[14px] text-ink">
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="pt">Português</option>
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-full bg-white px-5 py-2 text-[13px] font-semibold text-black disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save profile"}
      </button>
      {status ? <p className="text-[12px] text-muted-2">{status}</p> : null}

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
        <h3 className="text-[14px] font-semibold text-ink">Pinned review</h3>
        <p className="mt-1 text-[12px] text-muted-2">
          Pin a review to the top of your profile. Use the item page review id (advanced).
        </p>
        <button
          type="button"
          onClick={() => pinRating(null)}
          className="mt-2 rounded-full border border-white/10 px-3 py-1.5 text-[12px] text-muted hover:text-ink"
        >
          Unpin
        </button>
      </div>
    </div>
  );
}