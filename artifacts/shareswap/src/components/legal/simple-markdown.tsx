import { Fragment, type ReactNode } from "react";

// Just enough markdown for the legal documents in docs/legal: headings, paragraphs, bullet lists, block quotes, **bold**
// email addresses and links to a path on this site, [text](/path). Anything else is plain text. Nothing else is interpreted, and nothing is ever injected as HTML.

const LINK = /^\[([^\]]+)\]\((\/[\w\-/]*)\)$/;
const INLINE = /(\*\*[^*]+\*\*|\[[^\]]+\]\(\/[\w\-/]*\)|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

/** "Identity verification and face matching" => "identity-verification-and-face-matching": the anchor of a heading. */
export const headingId = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).filter((part) => part !== "").map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const link = LINK.exec(part);
    if (link) return <a key={i} href={link[2]} className="text-teal-600 underline">{link[1]}</a>;
    if (/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(part)) return <a key={i} href={`mailto:${part}`} className="text-teal-600 underline">{part}</a>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

type Block =
  | { kind: "h1" | "h2"; text: string }
  | { kind: "p" | "quote"; text: string }
  | { kind: "ul"; items: string[] };

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "p", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: "ul", items: list });
    list = null;
  };
  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    if (line.startsWith("## ")) { flushParagraph(); flushList(); blocks.push({ kind: "h2", text: line.slice(3) }); continue; }
    if (line.startsWith("# ")) { flushParagraph(); flushList(); blocks.push({ kind: "h1", text: line.slice(2) }); continue; }
    if (line.startsWith("> ")) { flushParagraph(); flushList(); blocks.push({ kind: "quote", text: line.slice(2) }); continue; }
    if (line.startsWith("- ")) { flushParagraph(); (list ??= []).push(line.slice(2)); continue; }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function SimpleMarkdown({ source, hideQuotes = false }: { source: string; hideQuotes?: boolean }) {
  return (
    <div className="space-y-4 text-gray-700 leading-relaxed" data-testid="simple-markdown">
      {parseBlocks(source).map((block, i) => {
        switch (block.kind) {
          case "h1": return <h1 key={i} className="text-3xl font-bold text-gray-900">{renderInline(block.text)}</h1>;
          case "h2": return <h2 key={i} id={headingId(block.text)} className="text-xl font-semibold text-gray-900 pt-2">{renderInline(block.text)}</h2>;
          case "quote": return hideQuotes ? null : <p key={i} className="rounded-md border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">{renderInline(block.text)}</p>;
          case "ul": return <ul key={i} className="list-disc space-y-1.5 pl-6">{block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}</ul>;
          default: return <p key={i}>{renderInline(block.text)}</p>;
        }
      })}
    </div>
  );
}
