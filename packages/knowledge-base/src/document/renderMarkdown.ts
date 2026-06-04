/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { getChildren, hasChildren } from "./DocumentNode";
import type { DocumentNode, TableCell, TableNode } from "./DocumentSchema";
import { NodeKind } from "./DocumentSchema";

function escapeCell(text: string): string {
  // Escape backslashes first so an existing `\` cannot combine with the pipe
  // escape below to form an ambiguous sequence, then escape pipes and flatten
  // newlines for GFM table cells.
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

/** Expand a possibly-ragged row to exactly `columnCount` cells, honoring colspan. */
function flattenRow(row: TableCell[], columnCount: number): string[] {
  const out: string[] = [];
  for (const c of row) {
    const text = escapeCell(c.text);
    for (let i = 0; i < Math.max(1, c.colspan); i++) out.push(text);
  }
  while (out.length < columnCount) out.push("");
  return out.slice(0, columnCount);
}

function renderTable(node: TableNode): string {
  // A table with no real columns (e.g. an all-empty layout/spacer table whose
  // columns were all pruned) renders to nothing rather than a phantom `| |` grid.
  if (node.columnCount < 1) return "";
  const cols = Math.max(1, node.columnCount);
  const headerCells =
    node.headerRows.length > 0
      ? flattenRow(node.headerRows[0], cols)
      : Array.from({ length: cols }, () => "");
  const lines: string[] = [];
  if (node.caption) lines.push(`**${node.caption}**`, "");
  lines.push(`| ${headerCells.join(" | ")} |`);
  lines.push(`| ${Array.from({ length: cols }, () => "---").join(" | ")} |`);
  // Any header rows beyond the first render as body rows so no data is lost.
  for (const hr of node.headerRows.slice(1)) lines.push(`| ${flattenRow(hr, cols).join(" | ")} |`);
  for (const r of node.rows) lines.push(`| ${flattenRow(r, cols).join(" | ")} |`);
  return lines.join("\n");
}

/** Render a document node (and its subtree) to GFM markdown. Inverse of StructuralParser. */
export function renderMarkdown(node: DocumentNode): string {
  switch (node.kind) {
    case NodeKind.TABLE:
      return renderTable(node);
    case NodeKind.LIST:
      return node.items.map((it, i) => (node.ordered ? `${i + 1}. ${it}` : `- ${it}`)).join("\n");
    case NodeKind.IMAGE:
      return `![${node.alt ?? ""}](${node.src})`;
    case NodeKind.PARAGRAPH:
    case NodeKind.SENTENCE:
      return node.text;
    case NodeKind.SECTION: {
      const heading = `${"#".repeat(Math.min(6, Math.max(1, node.level)))} ${node.title}`;
      const body = getChildren(node)
        .map(renderMarkdown)
        .filter((s) => s.length > 0);
      return [heading, ...body].join("\n\n");
    }
    case NodeKind.DOCUMENT:
    case NodeKind.TOPIC: {
      const body = hasChildren(node)
        ? getChildren(node)
            .map(renderMarkdown)
            .filter((s) => s.length > 0)
        : [];
      return body.join("\n\n");
    }
    default:
      return "";
  }
}
