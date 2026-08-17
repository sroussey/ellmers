/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Splits already-materialized text into lines without their terminators,
 * matching how the streaming server tasks feed their scan: CRLF and LF are
 * equivalent, and a trailing newline does not produce a final empty line.
 *
 * Walks the text with `indexOf` rather than `split(/\r?\n/)`, which materializes
 * an array holding every line of the document before the first is yielded — on
 * a large document that is a second full copy of it in memory, and the consumer
 * cannot begin until the whole split completes.
 */
export async function* linesFromText(text: string): AsyncGenerator<string> {
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    if (newline === -1) {
      yield text.slice(start);
      return;
    }
    const end = newline > start && text[newline - 1] === "\r" ? newline - 1 : newline;
    yield text.slice(start, end);
    start = newline + 1;
  }
}
