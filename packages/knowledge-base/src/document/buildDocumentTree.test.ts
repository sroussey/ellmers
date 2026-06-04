/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import type { ParagraphNode, SectionNode } from "./DocumentSchema";
import { NodeKind } from "./DocumentSchema";
import type { FlatBlock } from "./buildDocumentTree";
import { buildDocumentTree } from "./buildDocumentTree";

const para = (text: string): ParagraphNode => ({
  nodeId: text,
  kind: NodeKind.PARAGRAPH,
  range: { startOffset: 0, endOffset: 0 },
  text,
});

describe("buildDocumentTree", () => {
  it("nests subsections by heading level", () => {
    const blocks: FlatBlock[] = [
      { kind: "heading", level: 1, title: "Management" },
      { kind: "leaf", node: para("intro") },
      { kind: "heading", level: 2, title: "Executive Officers" },
      { kind: "leaf", node: para("officers body") },
      { kind: "heading", level: 1, title: "Risk Factors" },
      { kind: "leaf", node: para("risks") },
    ];
    const root = buildDocumentTree("Doc", blocks);
    expect(root.kind).toBe(NodeKind.DOCUMENT);
    expect(root.children).toHaveLength(2); // two level-1 sections
    const mgmt = root.children[0] as SectionNode;
    expect(mgmt.title).toBe("Management");
    expect(mgmt.children.map((c) => c.kind)).toEqual([NodeKind.PARAGRAPH, NodeKind.SECTION]);
    const exec = mgmt.children[1] as SectionNode;
    expect(exec.title).toBe("Executive Officers");
    expect(exec.level).toBe(2);
    expect(exec.children).toHaveLength(1);
  });

  it("attaches pre-heading lead-in prose to the root", () => {
    const blocks: FlatBlock[] = [
      { kind: "leaf", node: para("front matter") },
      { kind: "heading", level: 1, title: "Body" },
      { kind: "leaf", node: para("body") },
    ];
    const root = buildDocumentTree("Doc", blocks);
    expect(root.children[0].kind).toBe(NodeKind.PARAGRAPH);
    expect(root.children[1].kind).toBe(NodeKind.SECTION);
  });
});
