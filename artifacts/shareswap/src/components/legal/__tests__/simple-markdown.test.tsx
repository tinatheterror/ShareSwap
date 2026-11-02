import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SimpleMarkdown, parseBlocks } from "../simple-markdown";

afterEach(cleanup);

describe("parseBlocks", () => {
  it("reads headings, paragraphs joined across lines, bullet lists and quotes", () => {
    expect(parseBlocks("# Title\n\n> note\n\nfirst line\nsecond line\n\n## Part\n\n- one\n- two\n\nafter")).toEqual([
      { kind: "h1", text: "Title" },
      { kind: "quote", text: "note" },
      { kind: "p", text: "first line second line" },
      { kind: "h2", text: "Part" },
      { kind: "ul", items: ["one", "two"] },
      { kind: "p", text: "after" },
    ]);
  });
});

describe("SimpleMarkdown", () => {
  it("bolds, links email addresses, and never turns text into markup", () => {
    const { container } = render(<SimpleMarkdown source={'Write to **us** at help@example.org <script>alert(1)</script> <b>x</b>'} />);
    expect(container.querySelector("strong")?.textContent).toBe("us");
    expect(container.querySelector('a[href="mailto:help@example.org"]')).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("can leave out the review notes", () => {
    render(<SimpleMarkdown source={"> DRAFT for review\n\nBody"} hideQuotes />);
    expect(screen.queryByText(/DRAFT/)).toBeNull();
    expect(screen.getByText("Body")).toBeTruthy();
  });
});
