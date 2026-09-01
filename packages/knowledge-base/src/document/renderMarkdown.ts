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

/**
 * Escape the visible text portion of a markdown image (`![...]`). Closing /
 * opening square brackets would prematurely terminate or reopen the alt-text
 * span, letting an attacker break out of the image and inject arbitrary
 * markdown after it. Backslashes are escaped first so existing `\` cannot
 * combine with a subsequent escape. Embedded newlines are flattened to a
 * single space - an image label is a single inline run, so a raw `\n` would
 * terminate the inline span and let following lines render as block content.
 */
function escapeLinkText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/[\r\n]+/g, " ");
}

// Built via RegExp constructor so the C0/DEL range is expressed as `\x00`
// hex escapes in the string literal rather than as raw control bytes in
// the regex literal source.
// eslint-disable-next-line no-control-regex, prefer-regex-literals
const CONTROL_CHARS_RE = new RegExp("[\\x00-\\x1f\\x7f]", "g");

/**
 * Encode a URL destination as an angle-bracket-wrapped markdown destination
 * (`<...>`). Wrapping in `<...>` lets us safely carry characters that would
 * otherwise break a bare `(...)` destination (spaces, parens). Inside the
 * brackets we still must escape `>` (closes the destination), `\` (escape
 * char), and any newline / control character (would terminate the destination
 * and let following bytes render as block content). We also reject
 * `javascript:` and `data:` schemes outright - these are the standard XSS
 * vehicles for markdown image/link sources and have no legitimate use in our
 * generated documents.
 */
function escapeLinkDestination(url: string): string {
  // Strip C0/DEL control bytes (NUL, CR, LF, tab, etc.) BEFORE testing for
  // dangerous schemes. Otherwise an obfuscated input like `java\nscript:` or
  // `ja\x00vascript:` would pass the scheme test (the bytes split the
  // keyword), then have the control bytes stripped on the way out, emerging
  // as a literal `javascript:` destination in the rendered markdown.
  const stripped = url.replace(CONTROL_CHARS_RE, "");
  if (/^\s*(?:javascript|data|vbscript)\s*:/i.test(stripped)) {
    return "<>";
  }
  // Escape `>` and `\` so neither closes the bracketed destination nor
  // introduces an unintended escape sequence inside it.
  const safe = stripped.replace(/\\/g, "\\\\").replace(/>/g, "\\>");
  return `<${safe}>`;
}

/**
 * Escape attacker-controlled inline text that is rendered into a block
 * position where a leading character could turn the line into a new block
 * (heading, list item, blockquote, table row, fenced code, indented code).
 * We replace embedded newlines with a single space first - a raw `\n`
 * followed by `# ` or `- ` would start a new heading/list - then escape
 * leading block-starter characters at the start of the resulting line.
 * Pipes are also escaped because the same string flows into table-caption
 * positions, where an unescaped `|` would prematurely close a cell.
 */
function escapeInlineText(text: string): string {
  // Escape backslashes first so a user-supplied `\` cannot combine with the
  // pipe escape below into `\\|`, which markdown parses as literal-backslash
  // plus unescaped pipe.
  const oneLine = text
    .replace(/\\/g, "\\\\")
    .replace(/[\r\n]+/g, " ")
    .replace(/\|/g, "\\|");
  // Escape a leading character that would start a new markdown block. We
  // anchor at start-of-string and cover the standard block starters:
  //   `#` (heading), `-`/`+`/`*` (list item / thematic break), `>` (quote),
  //   `|` (table), digit followed by `.` or `)` (ordered list start),
  //   leading space (would render as indented code if 4+), `~` (fenced
  //   code), backtick (fenced code / inline code).
  return oneLine.replace(/^([#\-+*>|~` ]|\d+[.)])/, "\\$1");
}

/**
 * Pad or trim a possibly-ragged row to exactly `columnCount` cells.
 */
function flattenRow(row: TableCell[], columnCount: number): string[] {
  const out = row.map((c) => escapeCell(c.text));
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
  if (node.caption) lines.push(`**${escapeInlineText(node.caption)}**`, "");
  lines.push(`| ${headerCells.join(" | ")} |`);
  lines.push(`| ${Array.from({ length: cols }, () => "---").join(" | ")} |`);
  // Any header rows beyond the first render as body rows so no data is lost.
  for (const hr of node.headerRows.slice(1)) lines.push(`| ${flattenRow(hr, cols).join(" | ")} |`);
  for (const r of node.rows) lines.push(`| ${flattenRow(r, cols).join(" | ")} |`);
  return lines.join("\n");
}

/**
 * Render a document node (and its subtree) to GFM markdown: section headings,
 * paragraphs, GFM pipe tables, lists, and images. (Approximately the inverse of
 * StructuralParser's markdown parsing, which today covers only headings and
 * paragraphs - this renderer additionally emits tables/lists/images.)
 */
export function renderMarkdown(node: DocumentNode): string {
  switch (node.kind) {
    case NodeKind.TABLE:
      return renderTable(node);
    case NodeKind.LIST:
      return node.items
        .map((it) => escapeInlineText(it))
        .map((it, i) => (node.ordered ? `${i + 1}. ${it}` : `- ${it}`))
        .join("\n");
    case NodeKind.IMAGE:
      return `![${escapeLinkText(node.alt ?? "")}](${escapeLinkDestination(node.src)})`;
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
