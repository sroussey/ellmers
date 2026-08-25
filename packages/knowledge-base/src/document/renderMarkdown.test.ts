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

/** A cell already placed at every column index it covers, as a producer emits it. */
const spanned = (text: string, colspan: number, isHeader = false) => ({
  text,
  colspan,
  rowspan: 1,
  isHeader,
  numeric: undefined,
});

const tableNode = (
  columnCount: number,
  headerRows: ReturnType<typeof cell>[][],
  rows: ReturnType<typeof cell>[][]
) => ({
  nodeId: "t",
  kind: NodeKind.TABLE,
  range: { startOffset: 0, endOffset: 0 },
  text: "",
  caption: undefined,
  columnCount,
  headerRows,
  rows,
  stitchedFrom: 1,
});

describe("renderMarkdown table columns", () => {
  /**
   * `columnCount` is defined as "Columns after colspan expansion", so a row
   * arrives with one entry per column and the renderer must not expand it
   * again. Doing so overflowed the row and the trim dropped the real cells:
   * this exact shape — the two-column layout EDGAR filers build "The Offering"
   * out of — rendered as the label six times with the value deleted.
   */
  it("renders one cell per column slot for a row of materialized spans", () => {
    const label = spanned("Trust account", 3);
    const value = spanned("$200,000,000 held in trust", 3);
    const table = tableNode(6, [], [[label, label, label, value, value, value]]);
    const out = renderMarkdown(table as unknown as DocumentNode);
    expect(out).toContain("$200,000,000 held in trust");
    const dataRow = out.split("\n").at(-1) ?? "";
    expect(dataRow.split("|").filter((s) => s.trim().length > 0)).toEqual([
      " Trust account ",
      " Trust account ",
      " Trust account ",
      " $200,000,000 held in trust ",
      " $200,000,000 held in trust ",
      " $200,000,000 held in trust ",
    ]);
  });

  it("pads a ragged row out to the column count", () => {
    const table = tableNode(3, [], [[cell("only")]]);
    expect(
      renderMarkdown(table as unknown as DocumentNode)
        .split("\n")
        .at(-1)
    ).toBe("| only |  |  |");
  });

  it("trims a row longer than the column count", () => {
    const table = tableNode(2, [], [[cell("a"), cell("b"), cell("c")]]);
    expect(
      renderMarkdown(table as unknown as DocumentNode)
        .split("\n")
        .at(-1)
    ).toBe("| a | b |");
  });
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

    it("rejects obfuscated dangerous scheme with embedded newline", () => {
      // `java\nscript:` previously bypassed the scheme regex (the `\n`
      // split the keyword), then the C0/DEL strip ran on output and
      // collapsed it back to a literal `javascript:` destination.
      const img = {
        nodeId: "i3",
        kind: NodeKind.IMAGE,
        range: { startOffset: 0, endOffset: 0 },
        text: "",
        alt: "logo",
        src: "java\nscript:alert(1)",
      } as const;
      const md = renderMarkdown(img as unknown as DocumentNode);
      expect(md.toLowerCase()).not.toContain("javascript:");
      expect(md).toContain("![logo](<>)");
    });

    it("rejects obfuscated dangerous scheme with embedded NUL", () => {
      const img = {
        nodeId: "i4",
        kind: NodeKind.IMAGE,
        range: { startOffset: 0, endOffset: 0 },
        text: "",
        alt: "logo",
        src: "ja\x00vascript:alert(1)",
      } as const;
      const md = renderMarkdown(img as unknown as DocumentNode);
      expect(md.toLowerCase()).not.toContain("javascript:");
      expect(md).toContain("![logo](<>)");
    });

    it("rejects obfuscated dangerous scheme with embedded tab", () => {
      const img = {
        nodeId: "i5",
        kind: NodeKind.IMAGE,
        range: { startOffset: 0, endOffset: 0 },
        text: "",
        alt: "logo",
        src: "j\tavascript:alert(1)",
      } as const;
      const md = renderMarkdown(img as unknown as DocumentNode);
      expect(md.toLowerCase()).not.toContain("javascript:");
      expect(md).toContain("![logo](<>)");
    });

    it("rejects vbscript: scheme", () => {
      const img = {
        nodeId: "i6",
        kind: NodeKind.IMAGE,
        range: { startOffset: 0, endOffset: 0 },
        text: "",
        alt: "logo",
        src: "vbscript:msgbox(1)",
      } as const;
      const md = renderMarkdown(img as unknown as DocumentNode);
      expect(md.toLowerCase()).not.toContain("vbscript:");
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

    it("escapes backslash before pipe in inline text (CodeQL #136)", () => {
      // Input `\|` previously became `\\|` in output - which markdown parses
      // as literal-backslash plus unescaped pipe, defeating the pipe escape.
      // The backslash must be escaped to `\\` first so the pipe escape stands.
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
            items: ["a\\|b"],
          },
        ],
      };
      const md = renderMarkdown(root);
      // Expect `\\\\\\|` in source = `\\\|` in the rendered string = literal
      // `\` followed by an escaped `|` in markdown parsing.
      expect(md).toContain("- a\\\\\\|b");
    });
  });
});
