/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DocumentNode,
  DocumentRootNode,
  NodeRange,
  SectionNode,
  TopicNode,
} from "./DocumentSchema";
import { NodeKind } from "./DocumentSchema";

/**
 * Approximate token counting (v1) -- ~4 characters per token.
 * Used as a fallback when no real tokenizer is available.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Helper to check if a node has children
 */
export function hasChildren(
  node: DocumentNode
): node is DocumentRootNode | SectionNode | TopicNode {
  return (
    node.kind === NodeKind.DOCUMENT ||
    node.kind === NodeKind.SECTION ||
    node.kind === NodeKind.TOPIC
  );
}

/**
 * Helper to get all children of a node
 */
export function getChildren(node: DocumentNode): DocumentNode[] {
  if (hasChildren(node)) {
    return node.children;
  }
  return [];
}

/** Maximum recursion depth for tree traversal to prevent stack overflow */
const MAX_TRAVERSAL_DEPTH = 200;

/**
 * Traverse document tree depth-first
 */
export function* traverseDepthFirst(
  node: DocumentNode,
  depth: number = 0
): Generator<DocumentNode> {
  if (depth > MAX_TRAVERSAL_DEPTH) {
    throw new Error(`Document tree exceeds maximum depth of ${MAX_TRAVERSAL_DEPTH}`);
  }
  yield node;
  if (hasChildren(node)) {
    for (const child of node.children) {
      yield* traverseDepthFirst(child, depth + 1);
    }
  }
}

/**
 * Get node path from root to target node
 */
export function getNodePath(root: DocumentNode, targetNodeId: string): string[] | undefined {
  const path: string[] = [];

  function search(node: DocumentNode, depth: number): boolean {
    if (depth > MAX_TRAVERSAL_DEPTH) {
      throw new Error(`Document tree exceeds maximum depth of ${MAX_TRAVERSAL_DEPTH}`);
    }
    path.push(node.nodeId);
    if (node.nodeId === targetNodeId) {
      return true;
    }
    if (hasChildren(node)) {
      for (const child of node.children) {
        if (search(child, depth + 1)) {
          return true;
        }
      }
    }
    path.pop();
    return false;
  }

  return search(root, 0) ? path : undefined;
}

/**
 * Get document range for a node path
 */
export function getDocumentRange(root: DocumentNode, nodePath: string[]): NodeRange {
  let currentNode = root as DocumentRootNode | SectionNode | TopicNode;

  // Start from index 1 since nodePath[0] is the root
  for (let i = 1; i < nodePath.length; i++) {
    const targetId = nodePath[i];
    const children = currentNode.children;
    let found: DocumentNode | undefined;

    for (let j = 0; j < children.length; j++) {
      if (children[j].nodeId === targetId) {
        found = children[j];
        break;
      }
    }

    if (!found) {
      throw new Error(`Node with id ${targetId} not found in path`);
    }

    currentNode = found as DocumentRootNode | SectionNode | TopicNode;
  }

  return currentNode.range;
}
