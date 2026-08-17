/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Splits already-materialized text into lines without their terminators,
 * matching how `readline` feeds the streaming server tasks: CRLF and LF are
 * equivalent, and a trailing newline does not produce a final empty line.
 */
export async function* linesFromText(text: string): AsyncGenerator<string> {
  if (text.length === 0) {
    return;
  }
  const lines = text.split(/\r?\n/);
  if (text.endsWith("\n")) {
    lines.pop();
  }
  for (const line of lines) {
    yield line;
  }
}
