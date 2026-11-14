"use client";

import { useState, type ReactNode } from "react";

/**
 * Renders a review body written in a safe Markdown subset.
 *
 * Supported: paragraphs, `#`–`######` headings, `-`/`*`/`+` and `1.` lists,
 * `>` quotes, fenced code, horizontal rules, and inline **bold**, *italic*,
 * `code`, ~~strike~~ and [links](https://…). Links are limited to https and
 * app-relative paths; anything else renders as plain text. Raw HTML is never
 * interpreted, so a review cannot inject markup.
 */

function safeHref(href: string): string | null {
  const value = href.trim();
  if (value.startsWith("https://") || value.startsWith("/")) return value;
  return null;
}

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (!part) return null;
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={key} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("~~") && part.endsWith("~~")) {
      return <s key={key}>{part.slice(2, -2)}</s>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px] text-ink">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("_") && part.endsWith("_") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const href = safeHref(link[2] ?? "");
      if (!href) return <span key={key}>{link[1]}</span>;
      return (
        <a key={key} href={href} target="_blank" rel="noreferrer noopener" className="text-brand underline underline-offset-2">
          {link[1]}
        </a>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

function renderMarkdown(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(<p key={`p${key++}`}>{renderInline(paragraph.join(" "), `p${key}`)}</p>);
    paragraph = [];
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    blocks.push(
      <blockquote key={`q${key++}`} className="border-l-2 border-white/20 pl-3 text-muted-2">
        {renderInline(quote.join(" "), `q${key}`)}
      </blockquote>,
    );
    quote = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`l${key++}`} className={list.ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}>
        {list.items.map((item, index) => (
          <li key={index}>{renderInline(item, `li${key}-${index}`)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      if (code) {
        blocks.push(
          <pre key={`c${key++}`} className="overflow-x-auto rounded-lg bg-white/[0.06] p-3 text-[12px]">
            <code className="font-mono text-ink">{code.join("\n")}</code>
          </pre>,
        );
        code = null;
      } else {
        flushAll();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }

    if (line.trim() === "") {
      flushAll();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = (heading[1] ?? "#").length;
      const size = level === 1 ? "text-[17px]" : level === 2 ? "text-[15px]" : "text-[14px]";
      blocks.push(
        <p key={`h${key++}`} className={`${size} font-semibold text-ink`}>
          {renderInline(heading[2] ?? "", `h${key}`)}
        </p>,
      );
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(line.trim())) {
      flushAll();
      blocks.push(<hr key={`hr${key++}`} className="border-white/10" />);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      flushQuote();
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((bullet ?? ordered)![1] ?? "");
      continue;
    }

    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1] ?? "");
      continue;
    }

    flushQuote();
    flushList();
    paragraph.push(line.trim());
  }

  if (code) {
    blocks.push(
      <pre key={`c${key++}`} className="overflow-x-auto rounded-lg bg-white/[0.06] p-3 text-[12px]">
        <code className="font-mono text-ink">{code.join("\n")}</code>
      </pre>,
    );
  }
  flushAll();
  return blocks;
}

export function ReviewBody({
  text,
  spoiler = false,
  className,
}: {
  text: string;
  spoiler?: boolean;
  className?: string;
}) {
  const [revealed, setRevealed] = useState(!spoiler);
  const prose = `${className ?? ""} space-y-2 text-[13px] leading-relaxed text-muted`;
  const content = renderMarkdown(text);

  if (!spoiler) {
    return <div className={prose}>{content}</div>;
  }

  return (
    <div className="relative overflow-hidden rounded-xl">
      <div className={revealed ? prose : `${prose} select-none blur-[6px]`} aria-hidden={!revealed}>
        {content}
      </div>
      {!revealed ? (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/40"
        >
          <span className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">
            Spoiler
          </span>
          <span className="text-[12px] text-white/80">Tap to reveal this review</span>
        </button>
      ) : (
        <span className="mt-2 inline-block rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">
          Spoiler
        </span>
      )}
    </div>
  );
}