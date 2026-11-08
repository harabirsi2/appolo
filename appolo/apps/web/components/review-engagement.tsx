"use client";

import { useState } from "react";

const EMOJIS = ["🔥", "❤️", "👏", "😂", "😮", "😢"];

interface Comment {
  id: string;
  orgId: string;
  username: string;
  displayName: string;
  avatarHue: number;
  body: string;
  createdAt: string;
}

interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export function ReviewEngagement({
  ratingId,
  initialReactions,
  initialCommentCount,
}: {
  ratingId: string;
  initialReactions: Reaction[];
  initialCommentCount: number;
}) {
  const [reactions, setReactions] = useState<Reaction[]>(initialReactions);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [comment, setComment] = useState("");
  const [showComments, setShowComments] = useState(false);

  async function loadComments() {
    if (loaded) return;
    const res = await fetch(`/api/ratings/${ratingId}/comments`);
    if (res.ok) {
      const data = (await res.json()) as { comments: Comment[] };
      setComments(data.comments);
      setLoaded(true);
    }
  }

  async function toggle(emoji: string) {
    const res = await fetch(`/api/ratings/${ratingId}/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    });
    if (res.ok) {
      const data = (await res.json()) as { reactions: Reaction[] };
      setReactions(data.reactions);
    }
  }

  async function submitComment() {
    const trimmed = comment.trim();
    if (!trimmed) return;
    const res = await fetch(`/api/ratings/${ratingId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: trimmed }),
    });
    if (res.ok) {
      const data = (await res.json()) as { comments: Comment[] };
      setComments(data.comments);
      setLoaded(true);
      setComment("");
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-1">
        {EMOJIS.map((emoji) => {
          const found = reactions.find((r) => r.emoji === emoji);
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => toggle(emoji)}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                found?.mine
                  ? "border-brand/40 bg-brand/15 text-brand"
                  : "border-white/10 bg-white/5 text-muted hover:text-ink"
              }`}
            >
              {emoji} {found ? found.count : ""}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={async () => {
          setShowComments((v) => !v);
          if (!showComments) await loadComments();
        }}
        className="text-[11px] text-muted-2 hover:text-ink"
      >
        {showComments ? "Hide comments" : `Comments (${initialCommentCount})`}
      </button>
      {showComments ? (
        <div className="space-y-2">
          {comments.map((c) => (
            <div key={c.id} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5">
              <p className="text-[11px] font-medium text-ink">{c.displayName} <span className="text-muted-2">@{c.username}</span></p>
              <p className="mt-0.5 text-[12px] text-muted">{c.body}</p>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Write a comment…"
              className="h-9 flex-1 rounded-xl border border-white/[0.06] bg-[#1a1a1d] px-3 text-[12px] text-ink focus:border-white/20 focus:outline-none"
            />
            <button
              type="button"
              onClick={submitComment}
              className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-black"
            >
              Post
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}