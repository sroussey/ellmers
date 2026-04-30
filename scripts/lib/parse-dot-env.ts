/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parse a `.env`-style file into a flat key → value map. Supports:
 * - blank lines and `#` comments
 * - optional `export ` prefix
 * - unquoted values (trailing inline `# comment` stripped)
 * - single-quoted values (preserve embedded `#`; trailing `# comment` after
 *   the closing quote is stripped)
 * - double-quoted values (same trailing-comment handling, plus standard
 *   escapes `\n`, `\r`, `\t`, `\\`, `\"`)
 *
 * Throws on a non-blank, non-comment line that doesn't match `KEY=VALUE`,
 * so the caller can report a typo rather than silently dropping it.
 */
export function parseDotEnv(source: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const lines = source.split(/\r?\n/);
  const head = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || /^\s*(#|$)/.test(line)) continue;
    const match = head.exec(line);
    if (!match) {
      throw new Error(`malformed .env line ${i + 1}: ${line}`);
    }
    const [, key, rest] = match;
    out.set(key, parseValue(rest, i + 1));
  }
  return out;
}

function parseValue(rest: string, lineNumber: number): string {
  const first = rest[0];
  if (first === '"' || first === "'") {
    const quoted =
      first === '"' ? /^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?\s*$/ : /^'([^']*)'\s*(?:#.*)?\s*$/;
    const m = quoted.exec(rest);
    if (!m) throw new Error(`unterminated quoted value at line ${lineNumber}: ${rest}`);
    if (first === '"') {
      return m[1].replace(/\\([nrt"\\])/g, (_, ch) =>
        ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "t" ? "\t" : ch
      );
    }
    return m[1];
  }
  // Unquoted: strip inline comment introduced by ` #`, then trim.
  const hash = rest.search(/\s+#/);
  return (hash >= 0 ? rest.slice(0, hash) : rest).trim();
}
