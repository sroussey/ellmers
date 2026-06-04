/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { uuid4 } from "@workglow/util";
import type {
  DocumentNode,
  DocumentRootNode,
  ImageNode,
  ListNode,
  ParagraphNode,
  SectionNode,
  TableNode,
} from "./DocumentSchema";
import { NodeKind } from "./DocumentSchema";

/** A leaf node the converter has already built. */
type LeafNode = ParagraphNode | TableNode | ListNode | ImageNode;

/** Ordered input to the nester: a heading (opens/closes sections) or a leaf (content). */
export type FlatBlock =
  | { readonly kind: "heading"; readonly level: number; readonly title: string }
  | { readonly kind: "leaf"; readonly node: LeafNode };

/**
 * Fold an ordered list of typed blocks into a hierarchical DocumentRootNode.
 * Generalizes StructuralParser.parseMarkdown's stack nesting: a heading of level
 * L pops sections of level >= L, then opens a new section; leaves attach to the
 * current open section (or the root for pre-first-heading lead-in prose).
 *
 * Offsets are a running character count over node `text` (UTF-16 code units),
 * sufficient for downstream chunk linkage; exact source offsets are not preserved.
 */
export function buildDocumentTree(title: string, blocks: FlatBlock[]): DocumentRootNode {
  const root: DocumentRootNode = {
    nodeId: uuid4(),
    kind: NodeKind.DOCUMENT,
    range: { startOffset: 0, endOffset: 0 },
    text: title,
    title,
    children: [],
  };
  const stack: Array<DocumentRootNode | SectionNode> = [root];
  let offset = 0;

  const top = (): DocumentRootNode | SectionNode => stack[stack.length - 1];

  for (const block of blocks) {
    if (block.kind === "heading") {
      const level = Math.min(6, Math.max(1, block.level));
      while (
        stack.length > 1 &&
        top().kind === NodeKind.SECTION &&
        (top() as SectionNode).level >= level
      ) {
        const closed = stack.pop() as SectionNode;
        (closed.range as { endOffset: number }).endOffset = offset;
      }
      const startOffset = offset;
      offset += block.title.length;
      const section: SectionNode = {
        nodeId: uuid4(),
        kind: NodeKind.SECTION,
        level,
        title: block.title,
        range: { startOffset, endOffset: offset },
        text: block.title,
        children: [],
      };
      top().children.push(section);
      stack.push(section);
    } else {
      const startOffset = offset;
      offset += block.node.text.length;
      // Shallow-copy so we never mutate the caller's node; the tree owns a copy
      // carrying the computed running-offset range.
      const node = {
        ...block.node,
        range: { startOffset, endOffset: offset },
      } as DocumentNode;
      top().children.push(node);
    }
  }

  while (stack.length > 1) {
    const closed = stack.pop() as SectionNode;
    (closed.range as { endOffset: number }).endOffset = offset;
  }
  (root.range as { endOffset: number }).endOffset = offset;
  return root;
}
