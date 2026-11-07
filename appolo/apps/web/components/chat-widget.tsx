"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ChatMessage {
  id: string;
  direction: "inbound" | "outbound";
  senderType: "contact" | "user" | "ai" | "system";
  body: string;
  createdAt: string;
}

const VISITOR_PREFIX = "appolo_webchat_visitor_";

function readVisitorId(key: string): string {
  const storageKey = `${VISITOR_PREFIX}${key}`;
  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing) return existing;
    const generated =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(storageKey, generated);
    return generated;
  } catch {
    return `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function ChatWidget({ publicKey, orgName }: { publicKey: string; orgName: string }) {
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisitorId(readVisitorId(publicKey));
  }, [publicKey]);

  const load = useCallback(async () => {
    if (!visitorId) return;
    try {
      const response = await fetch(
        `/api/webchat/${encodeURIComponent(publicKey)}/messages?visitorId=${encodeURIComponent(visitorId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const data = (await response.json()) as { messages: ChatMessage[] };
      setMessages(data.messages ?? []);
    } catch {
      // Transient network failures should not surface to the visitor.
    }
  }, [publicKey, visitorId]);

  useEffect(() => {
    if (!visitorId) return;
    void load();
    const id = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(id);
  }, [visitorId, load]);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!visitorId || !draft.trim() || sending) return;
    setSending(true);
    setError(null);
    const body = draft.trim();
    setDraft("");
    try {
      const response = await fetch(`/api/webchat/${encodeURIComponent(publicKey)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, body }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? "Message could not be sent.");
        setDraft(body);
      } else {
        await load();
      }
    } catch {
      setError("Message could not be sent.");
      setDraft(body);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/15 text-sm font-semibold text-brand-soft">
          {orgName.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">{orgName}</p>
          <p className="text-xs text-muted-2">We typically reply within a few minutes.</p>
        </div>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="mx-auto max-w-xs text-center text-sm text-muted">
            Hi! Send us a message and a team member will get back to you.
          </p>
        ) : (
          messages.map((message) => {
            const mine = message.direction === "inbound";
            return (
              <div key={message.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    mine
                      ? "max-w-[80%] rounded-2xl rounded-br-sm bg-brand px-3 py-2 text-sm text-white"
                      : "max-w-[80%] rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2 text-sm text-ink"
                  }
                >
                  <p className="whitespace-pre-wrap">{message.body}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {error ? <p className="px-4 pb-1 text-xs text-danger">{error}</p> : null}

      <form onSubmit={send} className="flex items-end gap-2 border-t border-border bg-surface px-3 py-3">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(event);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Type your message..."
          className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
