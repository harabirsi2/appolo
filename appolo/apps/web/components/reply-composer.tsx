"use client";

import { useEffect, useState } from "react";
import { Button, Select, Textarea } from "@appolo/ui";
import { sendMessageAction } from "@/lib/actions";

export interface SavedReplyOption {
  id: string;
  title: string;
  body: string;
}

export function ReplyComposer({
  conversationId,
  savedReplies,
  disabled = false,
  resetKey = 0,
}: {
  conversationId: string;
  savedReplies: SavedReplyOption[];
  disabled?: boolean;
  resetKey?: number;
}) {
  const [body, setBody] = useState("");

  useEffect(() => {
    setBody("");
  }, [resetKey]);

  return (
    <form action={sendMessageAction} className="space-y-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      {savedReplies.length > 0 ? (
        <Select
          value=""
          aria-label="Insert a saved reply"
          onChange={(event) => {
            const reply = savedReplies.find((item) => item.id === event.target.value);
            if (reply) setBody(reply.body);
          }}
          disabled={disabled}
        >
          <option value="">Insert a saved reply…</option>
          {savedReplies.map((reply) => (
            <option key={reply.id} value={reply.id}>
              {reply.title}
            </option>
          ))}
        </Select>
      ) : null}
      <Textarea
        name="body"
        rows={3}
        required
        value={body}
        onChange={(event) => setBody(event.target.value)}
        disabled={disabled}
        placeholder={disabled ? "Sending is blocked for this contact." : "Write a reply…"}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-2">
          Consent is checked server-side before every send.
        </p>
        <Button type="submit" disabled={disabled || body.trim().length === 0}>
          Send
        </Button>
      </div>
    </form>
  );
}