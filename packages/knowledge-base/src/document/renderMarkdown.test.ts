/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import type { DocumentNode, DocumentRootNode } from "./DocumentSchema";
import { NodeKind } from "./DocumentSchema";
import { renderMarkdown } from "./renderMarkdown";

const cell = (text: string, isHeader = false) => ({
  text,
  colspan: 1,
  rowspan: 1,
  isHeader,
  numeric: undefined,
});

describe("renderMarkdown", () => {
  it("escapes backslashes and pipes in table cells", () => {
    const table = {
      nodeId: "t",
      kind: NodeKind.TABLE,
      range: { startOffset: 0, endOffset: 0 },
      text: "",
      caption: undefined,
      columnCount: 1,
      headerRows: [],
      rows: [[cell("a\\b|c")]],
      stitchedFrom: 1,
    } as const;
    const md = renderMarkdown(table as unknown as DocumentNode);
    // backslash escaped first (\\) then pipe (\|), so no ambiguous sequence
    expect(md).toContain("a\\\\b\\|c");
  });

  it("renders sections as headings and a table as a GFM pipe table", () => {
    const root: DocumentRootNode = {
      nodeId: "r",
      kind: NodeKind.DOCUMENT,
      range: { startOffset: 0, endOffset: 0 },
      text: "Doc",
      title: "Doc",
      children: [
        {
          nodeId: "s1",
          kind: NodeKind.SECTION,
          level: 1,
          title: "Management",
          range: { startOffset: 0, endOffset: 0 },
          text: "Management",
          children: [
            {
              nodeId: "p1",
              kind: NodeKind.PARAGRAPH,
              range: { startOffset: 0, endOffset: 0 },
              text: "Intro line.",
            },
            {
              nodeId: "t1",
              kind: NodeKind.TABLE,
              range: { startOffset: 0, endOffset: 0 },
              text: "",
              caption: undefined,
              columnCount: 2,
              stitchedFrom: 1,
              headerRows: [[cell("Name", true), cell("Age", true)]],
              rows: [[cell("Alice"), cell("40")]],
            },
          ],
        },
      ],
    };
    const md = renderMarkdown(root);
    expect(md).toContain("# Management");
    expect(md).toContain("Intro line.");
    expect(md).toContain("| Name | Age |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| Alice | 40 |");
  });

  it("renders ordered and unordered lists", () => {
    const root: DocumentRootNode = {
      nodeId: "r",
      kind: NodeKind.DOCUMENT,
      range: { startOffset: 0, endOffset: 0 },
      text: "D",
      title: "D",
      children: [
        {
          nodeId: "l1",
          kind: NodeKind.LIST,
          range: { startOffset: 0, endOffset: 0 },
          text: "",
          ordered: false,
          items: ["a", "b"],
        },
        {
          nodeId: "l2",
          kind: NodeKind.LIST,
          range: { startOffset: 0, endOffset: 0 },
          text: "",
          ordered: true,
          items: ["x", "y"],
        },
      ],
    };
    const md = renderMarkdown(root);
    expect(md).toContain("- a");
    expect(md).toContain("1. x");
    expect(md).toContain("2. y");
  });

  it("renders a column-less (all-empty) table as empty, not a phantom grid", () => {
    const table = {
      nodeId: "t0",
      kind: NodeKind.TABLE,
      range: { startOffset: 0, endOffset: 0 },
      text: "",
      caption: undefined,
      columnCount: 0,
      headerRows: [],
      rows: [],
      stitchedFrom: 1,
    } as const;
    expect(renderMarkdown(table as unknown as DocumentNode)).toBe("");
  });

  describe("injection hardening", () => {
    it("escapes image alt with closing bracket", () => {
      // Attacker-supplied alt that tries to close the alt-text span and
      // open a new bracketed group containing a javascript: URL. The
      // brackets must be backslash-escaped so the original `![...]` stays
      // a single image and no extra markdown groups are produced.
      const img = {
        nodeId: "i1",
        kind: NodeKind.IMAGE,
        range: { startOffset: 0, endOffset: 0 },
        text: "",
        alt: "](javascript:alert(1)) ![](data:,)",
        src: "https://example.com/safe.png",
      } as const;
      const md = renderMarkdown(img as unknown as DocumentNode);
      // The injected `]` must be escaped.
      expect(md).toContain("\\]");
      // The opening `[` in the injected `![]` payload must be escaped too.
      expect(md).toContain("\\[");
      // The src is unchanged (it was already safe).
      expect(md).toContain("<https://example.com/safe.png>");
    });

    it("rejects image src with javascript: scheme", () => {
      const img = {
        nodeId: "i2",
        kind: NodeKind.IMAGE,
        range: { startOffset: 0, endOffset: 0 },
        text: "",
        alt: "logo",
        src: "javascript:alert(1)",
      } as const;
      const md = renderMarkdown(img as unknown as DocumentNode);
      // The destination must be neutralised; no `javascript:` survives.
      expect(md.toLowerCase()).not.toContain("javascript:");
      // The result is still a syntactically valid (empty-dest) image.
      expect(md).toContain("![logo](<>)");
    });

    it("escapes list item that starts with #", () => {
      const root: DocumentRootNode = {
        nodeId: "r",
        kind: NodeKind.DOCUMENT,
        range: { startOffset: 0, endOffset: 0 },
        text: "D",
        title: "D",
        children: [
          {
            nodeId: "l1",
            kind: NodeKind.LIST,
            range: { startOffset: 0, endOffset: 0 },
            text: "",
            ordered: false,
            items: ["# Injected heading"],
          },
        ],
      };
      const md = renderMarkdown(root);
      // The list bullet stays, the `#` is escaped so it never starts a
      // heading.
      expect(md).toContain("- \\# Injected heading");
    });

    it("escapes list item containing newline + heading", () => {
      const root: DocumentRootNode = {
        nodeId: "r",
        kind: NodeKind.DOCUMENT,
        range: { startOffset: 0, endOffset: 0 },
        text: "D",
        title: "D",
        children: [
          {
            nodeId: "l1",
            kind: NodeKind.LIST,
            range: { startOffset: 0, endOffset: 0 },
            text: "",
            ordered: false,
            items: ["safe text\n# Injected"],
          },
        ],
      };
      const md = renderMarkdown(root);
      // The newline must be flattened so the list item stays a single line.
      expect(md).not.toMatch(/safe text\n# Injected/);
      // The full content lives in one bullet.
      expect(md).toContain("- safe text # Injected");
    });

    it("escapes caption containing **bold**", () => {
      const table = {
        nodeId: "t",
        kind: NodeKind.TABLE,
        range: { startOffset: 0, endOffset: 0 },
        text: "",
        caption: "**bold**",
        columnCount: 1,
        headerRows: [],
        rows: [[cell("x")]],
        stitchedFrom: 1,
      } as const;
      const md = renderMarkdown(table as unknown as DocumentNode);
      // Leading `*` is escaped so the caption does not turn into a list
      // item or bold span at the start of the line.
      expect(md).toContain("**\\**bold**");
    });

    it("escapes caption containing pipe", () => {
      const table = {
        nodeId: "t",
        kind: NodeKind.TABLE,
        range: { startOffset: 0, endOffset: 0 },
        text: "",
        caption: "col1|col2",
        columnCount: 1,
        headerRows: [],
        rows: [[cell("x")]],
        stitchedFrom: 1,
      } as const;
      const md = renderMarkdown(table as unknown as DocumentNode);
      // Pipe is escaped so the caption stays a single bold run.
      expect(md).toContain("**col1\\|col2**");
    });
  });
});
