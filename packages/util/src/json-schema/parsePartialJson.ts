/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Attempts to parse a potentially incomplete JSON string into a partial object.
 *
 * Useful for progressive rendering of streamed JSON output from AI providers.
 * Each call returns the most complete object that can be parsed from the
 * accumulated text so far.
 *
 * Strategy:
 * 1. Try JSON.parse directly (handles complete JSON)
 * 2. If that fails, scan the object while tracking brackets/strings, then
 *    strip trailing incomplete tokens and close any still-open delimiters
 *
 * @param text - The (possibly incomplete) JSON string
 * @returns The parsed partial object, or undefined if text is too incomplete
 */
export function parsePartialJson(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  // Fast path: try parsing as-is
  try {
    const result = JSON.parse(trimmed);
    if (typeof result === "object" && result !== null && !Array.isArray(result)) {
      return result as Record<string, unknown>;
    }
    return undefined;
  } catch {
    // Fall through to repair logic
  }

  // Must start with '{' for an object
  if (trimmed[0] !== "{") return undefined;

  const repaired = repairJson(trimmed);
  if (repaired === undefined) return undefined;

  try {
    const result = JSON.parse(repaired);
    if (typeof result === "object" && result !== null && !Array.isArray(result)) {
      return result as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Attempts to repair incomplete JSON by closing open structures.
 * Returns the repaired string, or undefined if the text is too malformed.
 */
function repairJson(text: string): string | undefined {
  let result = "";
  let i = 0;
  const len = text.length;

  // Track open delimiters for closing
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  while (i < len) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      result += ch;
      i++;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      result += ch;
      i++;
      continue;
    }

    if (inString) {
      if (ch === '"') {
        inString = false;
        result += ch;
        i++;
        continue;
      }
      result += ch;
      i++;
      continue;
    }

    // Not in a string
    switch (ch) {
      case '"':
        inString = true;
        result += ch;
        i++;
        break;
      case "{":
        stack.push("}");
        result += ch;
        i++;
        break;
      case "[":
        stack.push("]");
        result += ch;
        i++;
        break;
      case "}":
        if (stack.length > 0 && stack[stack.length - 1] === "}") {
          stack.pop();
          result += ch;
          i++;
        } else {
          // Mismatched brace, truncate here
          return closeStack(result, stack);
        }
        break;
      case "]":
        if (stack.length > 0 && stack[stack.length - 1] === "]") {
          stack.pop();
          result += ch;
          i++;
        } else {
          return closeStack(result, stack);
        }
        break;
      default:
        result += ch;
        i++;
        break;
    }
  }

  // Reached the end with unclosed structures
  if (inString) {
    // Close the unclosed string, then close the stack
    result += '"';
  }

  if (stack.length === 0) {
    // Already valid
    return result;
  }

  return closeStack(cleanTrailing(result), stack);
}

/**
 * Removes trailing incomplete tokens that would prevent JSON parsing.
 * Strips trailing commas, colons, and incomplete key/value fragments.
 */
function cleanTrailing(text: string): string {
  // Remove trailing whitespace
  let s = text.trimEnd();

  // Repeatedly strip trailing problematic characters
  let changed = true;
  while (changed) {
    changed = false;
    const trimmed = s.trimEnd();

    // Trailing comma
    if (trimmed.endsWith(",")) {
      s = trimmed.slice(0, -1);
      changed = true;
      continue;
    }

    // Trailing colon (incomplete key-value pair)
    if (trimmed.endsWith(":")) {
      // Remove the colon and the preceding key
      const withoutColon = trimmed.slice(0, -1).trimEnd();
      // Remove the key (should be a string ending with ")
      if (withoutColon.endsWith('"')) {
        const keyStart = withoutColon.lastIndexOf('"', withoutColon.length - 2);
        if (keyStart >= 0) {
          // Also remove any preceding comma
          let before = withoutColon.slice(0, keyStart).trimEnd();
          if (before.endsWith(",")) {
            before = before.slice(0, -1);
          }
          s = before;
          changed = true;
          continue;
        }
      }
      // Can't find the key, just remove the colon
      s = withoutColon;
      changed = true;
      continue;
    }

    // Trailing incomplete value after a colon (e.g., `"key": tru` or `"key": 12`)
    // Check if there's an incomplete bare token at the end. The pair may be
    // preceded by a comma (subsequent property) OR an opening brace (the very
    // first property of an object) — both must be detected so the first
    // streamed property degrades to a partial `{}` instead of failing entirely.
    const bareTokenMatch = trimmed.match(
      /(,|\{)\s*"[^"]*"\s*:\s*(?:tru|fal|nul|true|false|null|[\d.eE+-]+)$/
    );
    if (bareTokenMatch) {
      // Check if the bare value is complete
      const valueStr = trimmed.slice(trimmed.lastIndexOf(":") + 1).trim();
      try {
        JSON.parse(valueStr);
        // Value is complete, keep it
      } catch {
        // Value is incomplete, remove the whole key-value pair. Keep the leading
        // boundary character (comma or brace) so the surrounding structure
        // (and the closeStack pass) can still close the object/array correctly.
        const boundary = bareTokenMatch[1];
        const cut = trimmed.slice(0, bareTokenMatch.index!).trimEnd();
        s = boundary === "{" ? `${cut}{` : cut;
        if (boundary !== "{" && s.endsWith(",")) s = s.slice(0, -1);
        changed = true;
        continue;
      }
    }
  }

  return s;
}

/**
 * Closes all open delimiters in the stack.
 */
function closeStack(text: string, stack: string[]): string {
  return text + [...stack].reverse().join("");
}
