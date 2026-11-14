"use client";

import { useState } from "react";
import Link from "next/link";
import type { PodDetail, PodMemberView, PodRole } from "@/lib/services/social";
import { MediaArt } from "./media-art";
import { Avatar } from "./podiums";

export function PodEditor({ pod: initial }: { pod: PodDetail }) {
  const [pod, setPod] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [isCollaborative, setIsCollaborative] = useState(initial.isCollaborative);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [invite, setInvite] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  async function saveMeta() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/pods/${pod.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, isCollaborative }),
      });
      if (res.ok) {
        const data = (await res.json()) as { pod: PodDetail };
        setPod(data.pod);
        setIsCollaborative(data.pod.isCollaborative);
        setMessage("Saved");
      } else {
        setMessage("Could not save");
      }
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(itemId: string) {
    const res = await fetch(`/api/pods/${pod.id}/items`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    if (res.ok) {
      const data = (await res.json()) as { pod: PodDetail };
      setPod(data.pod);
    }
  }

  async function move(itemId: string, direction: -1 | 1) {
    const ids = pod.entries.map((e) => e.id);
    const index = ids.indexOf(itemId);
    if (index < 0) return;
    const next = index + direction;
    if (next < 0 || next >= ids.length) return;
    const reordered = [...ids];
    const tmp = reordered[index]!;
    reordered[index] = reordered[next]!;
    reordered[next] = tmp;
    const res = await fetch(`/api/pods/${pod.id}/items`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds: reordered }),
    });
    if (res.ok) {
      const data = (await res.json()) as { pod: PodDetail };
      setPod(data.pod);
    }
  }

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    if (!invite.trim()) return;
    setMemberBusy(true);
    setMemberError(null);
    try {
      const res = await fetch(`/api/pods/${pod.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: invite.trim(), role: inviteRole }),
      });
      const data = (await res.json().catch(() => ({}))) as { pod?: PodDetail; error?: string };
      if (!res.ok || !data.pod) throw new Error(data.error ?? "Could not add that person.");
      setPod(data.pod);
      setInvite("");
    } catch (caught) {
      setMemberError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setMemberBusy(false);
    }
  }

  async function changeRole(member: PodMemberView, role: Exclude<PodRole, "owner">) {
    setMemberBusy(true);
    setMemberError(null);
    try {
      const res = await fetch(`/api/pods/${pod.id}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: member.username, role }),
      });
      const data = (await res.json().catch(() => ({}))) as { pod?: PodDetail; error?: string };
      if (!res.ok || !data.pod) throw new Error(data.error ?? "Could not change that role.");
      setPod(data.pod);
    } catch (caught) {
      setMemberError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setMemberBusy(false);
    }
  }

  async function removeMember(member: PodMemberView) {
    setMemberBusy(true);
    setMemberError(null);
    try {
      const res = await fetch(`/api/pods/${pod.id}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: member.username }),
      });
      const data = (await res.json().catch(() => ({}))) as { pod?: PodDetail; error?: string };
      if (!res.ok || !data.pod) throw new Error(data.error ?? "Could not remove that person.");
      setPod(data.pod);
    } catch (caught) {
      setMemberError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setMemberBusy(false);
    }
  }

  async function deletePod() {
    if (!confirm("Delete this pod?")) return;
    const res = await fetch(`/api/pods/${pod.id}`, { method: "DELETE" });
    if (res.ok) {
      window.location.href = "/app/profile";
    }
  }

  return (
    <div className="mt-4 space-y-6">
      <div className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-11 w-full rounded-xl border border-white/[0.06] bg-[#1a1a1d] px-3 text-[14px] text-ink focus:border-white/20 focus:outline-none"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-white/[0.06] bg-[#1a1a1d] px-3 py-2 text-[14px] text-ink focus:border-white/20 focus:outline-none"
        />
        <label className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
          <input
            type="checkbox"
            checked={isCollaborative}
            onChange={(e) => setIsCollaborative(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-ink">Collaborative pod</span>
            <span className="block text-[11px] text-muted-2">
              Invite members, let editors add titles, and show a group score on every title.
            </span>
          </span>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={saveMeta}
            disabled={saving}
            className="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={deletePod}
            className="rounded-full border border-red-500/40 px-4 py-2 text-[13px] font-semibold text-red-300"
          >
            Delete pod
          </button>
          {message ? <span className="self-center text-[12px] text-muted-2">{message}</span> : null}
        </div>
      </div>

      {pod.isCollaborative ? (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-ink">Members</h2>
            <span className="text-[11px] text-muted-2">{pod.memberCount}</span>
          </div>
          <ul className="mt-2 space-y-2">
            {pod.members.map((member) => (
              <li key={member.orgId} className="flex items-center gap-2.5 rounded-xl border border-white/[0.05] bg-white/[0.03] p-2">
                <Avatar name={member.displayName} hue={member.avatarHue} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{member.displayName}</p>
                  <p className="truncate text-[11px] text-muted-2">{`@${member.username}`}</p>
                </div>
                {member.role === "owner" ? (
                  <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                    Owner
                  </span>
                ) : (
                  <>
                    <select
                      value={member.role}
                      onChange={(e) => changeRole(member, e.target.value as "editor" | "viewer")}
                      disabled={memberBusy}
                      className="rounded-lg border border-white/10 bg-[#1a1a1d] px-2 py-1 text-[11px] text-ink"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => removeMember(member)}
                      disabled={memberBusy}
                      className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-red-300 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </>
                )}
              </li>
            ))}
            {pod.members.length === 0 ? (
              <li className="rounded-xl border border-white/[0.05] bg-white/[0.03] p-3 text-[12px] text-muted">
                Save to make yourself the first member.
              </li>
            ) : null}
          </ul>
          <form onSubmit={addMember} className="mt-3 flex gap-2">
            <input
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder="username"
              className="h-9 min-w-0 flex-1 rounded-lg border border-white/[0.06] bg-[#1a1a1d] px-2.5 text-[12px] text-ink placeholder:text-muted-2 focus:border-white/20 focus:outline-none"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}
              className="rounded-lg border border-white/10 bg-[#1a1a1d] px-2 text-[11px] text-ink"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button
              type="submit"
              disabled={memberBusy || !invite.trim()}
              className="rounded-full border border-white/10 px-3 text-[12px] text-muted hover:text-ink disabled:opacity-40"
            >
              Add
            </button>
          </form>
          {memberError ? <p className="mt-2 text-[11px] text-danger">{memberError}</p> : null}
        </div>
      ) : null}

      <div>
        <h2 className="mb-3 text-[15px] font-semibold text-ink">Items ({pod.entries.length})</h2>
        <ul className="space-y-2">
          {pod.entries.map((entry, index) => (
            <li key={entry.id} className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-2.5">
              <MediaArt kind={entry.kind} title={entry.title} imageUrl={entry.imageUrl} sizes="40px" className="h-10 w-10 rounded-lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{entry.title}</p>
                <p className="truncate text-[11px] text-muted-2">{entry.subtitle}</p>
              </div>
              {entry.consensus ? (
                <span className="shrink-0 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                  Group {entry.consensus.average.toFixed(1)}
                </span>
              ) : null}
              <div className="flex gap-1">
                <button type="button" aria-label={`Move ${entry.title} up`} onClick={() => move(entry.id, -1)} disabled={index === 0} className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-muted disabled:opacity-30">↑</button>
                <button type="button" aria-label={`Move ${entry.title} down`} onClick={() => move(entry.id, 1)} disabled={index === pod.entries.length - 1} className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-muted disabled:opacity-30">↓</button>
                <button type="button" onClick={() => removeItem(entry.id)} className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-red-300">Remove</button>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-muted-2">
          Add items from any item page using “Add to pod”.
        </p>
      </div>

      <div>
        <Link href={`/pods/${pod.id}`} className="text-[12px] text-brand hover:underline">
          View public pod →
        </Link>
      </div>
    </div>
  );
}