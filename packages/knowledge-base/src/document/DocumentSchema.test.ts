/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { getChildren, hasChildren, traverseDepthFirst } from "./DocumentNode";
import type { DocumentNode, ImageNode, ListNode, TableNode } from "./DocumentSchema";
import { NodeKind } from "./DocumentSchema";

describe("new leaf node kinds", () => {
  it("exposes table/list/image discriminants", () => {
    expect(NodeKind.TABLE).toBe("table");
    expect(NodeKind.LIST).toBe("list");
    expect(NodeKind.IMAGE).toBe("image");
  });

  it("treats table/list/image as leaves", () => {
    const table: TableNode = {
      nodeId: "t1",
      kind: NodeKind.TABLE,
      range: { startOffset: 0, endOffset: 0 },
      text: "| a |\n| - |\n| 1 |",
      caption: undefined,
      columnCount: 1,
      headerRows: [[{ text: "a", colspan: 1, rowspan: 1, isHeader: true, numeric: undefined }]],
      rows: [[{ text: "1", colspan: 1, rowspan: 1, isHeader: false, numeric: 1 }]],
      stitchedFrom: 1,
    };
    expect(hasChildren(table)).toBe(false);
    expect(getChildren(table)).toEqual([]);
    expect([...traverseDepthFirst(table as DocumentNode)]).toHaveLength(1);
  });

  it("types list and image nodes", () => {
    const list: ListNode = {
      nodeId: "l1",
      kind: NodeKind.LIST,
      range: { startOffset: 0, endOffset: 0 },
      text: "- a\n- b",
      ordered: false,
      items: ["a", "b"],
    };
    const image: ImageNode = {
      nodeId: "i1",
      kind: NodeKind.IMAGE,
      range: { startOffset: 0, endOffset: 0 },
      text: "![x](y.png)",
      src: "y.png",
      alt: "x",
    };
    expect(list.items).toHaveLength(2);
    expect(image.src).toBe("y.png");
    // list and image are leaves too — verified via the real helpers
    expect(hasChildren(list as DocumentNode)).toBe(false);
    expect(getChildren(list as DocumentNode)).toEqual([]);
    expect(hasChildren(image as DocumentNode)).toBe(false);
    expect(getChildren(image as DocumentNode)).toEqual([]);
  });
});
