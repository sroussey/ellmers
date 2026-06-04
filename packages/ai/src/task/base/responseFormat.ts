/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export type ResponseFormat = "text" | "markdown";

/**
 * Returns a system-prompt addendum instructing the model how to format its
 * reply. Returns an empty string for plain text or when no format is
 * specified, so callers can unconditionally concatenate the result.
 */
export function buildResponseFormatAddendum(format: ResponseFormat | undefined): string {
  if (format === "markdown") {
    return [
      "Format your reply as GitHub-flavored Markdown:",
      "- Use headings, bullet lists, numbered lists, tables, and fenced code blocks where they help readability.",
      "- Use **bold** and *italic* sparingly for emphasis.",
      "- Keep paragraphs short.",
    ].join("\n");
  }
  return "";
}

/**
 * Directive for inline citation style when KB context is provided to the
 * model. Instructs the model to use Markdown links instead of numeric
 * footnotes so citations render naturally inside streamed Markdown.
 */
export const KB_INLINE_CITATION_DIRECTIVE = [
  "When you reference information from the context above, cite it inline as a",
  "Markdown link: write the natural anchor text in brackets followed by the",
  "URL in parentheses, e.g. `[the dashboard](https://workglow.com/help/dashboard)`.",
  "Do not use numeric `[1]`-style citations. If a context entry has no URL,",
  "describe it in prose without a link.",
].join("\n");
