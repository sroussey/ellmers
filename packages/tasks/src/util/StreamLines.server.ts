/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Splits a byte stream into lines with a hard per-line cap.
 *
 * `readline.createInterface` accumulates an unterminated line without bound: a
 * 640 MB newline-free stream threw `RangeError: Invalid string length` from a
 * stream `'data'` listener, which surfaces as an `uncaughtException` rather
 * than an iterator rejection — so the caller's try/catch could not see it and
 * the process died.
 *
 * A line reaching `maxLineChars` with no terminator yields its first
 * `maxLineChars` characters, and the rest of that physical line is discarded up
 * to the next `\n`. `setEncoding` puts a `StringDecoder` in front, so a
 * multi-byte character split across two reads is not corrupted.
 */
export async function* linesFromStream(
  stream: NodeJS.ReadableStream,
  maxLineChars: number
): AsyncGenerator<string> {
  stream.setEncoding("utf8");

  let pending = "";
  let skipping = false;

  const stripCr = (line: string): string => (line.endsWith("\r") ? line.slice(0, -1) : line);

  for await (const chunk of stream as AsyncIterable<string>) {
    pending += chunk;

    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (skipping) {
        skipping = false;
      } else {
        yield stripCr(line);
      }
      newline = pending.indexOf("\n");
    }

    if (!skipping && pending.length >= maxLineChars) {
      yield pending.slice(0, maxLineChars);
      pending = "";
      skipping = true;
    } else if (skipping) {
      pending = "";
    }
  }

  if (!skipping && pending.length > 0) {
    yield stripCr(pending);
  }
}
