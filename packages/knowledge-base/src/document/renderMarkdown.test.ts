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
});
