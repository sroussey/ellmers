/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskInvalidInputError } from "@workglow/task-graph";
import { SECURITY_LIMITS } from "@workglow/util";

interface PatternScan {
  /** Every `[` in the source, including literals inside a class. */
  readonly bracketCount: number;
  /** A quantified group whose own body already quantifies, e.g. `(a+)+`. */
  readonly nestedQuantifiers: boolean;
}

/**
 * Walks a regex source once, tracking character classes (so a quantifier
 * inside `[...]` is not read as one) and group nesting on a stack.
 *
 * The scan is hand-written rather than regex-driven on purpose: stripping
 * classes with `\[(?:[^\]\\]|\\.)*\]` is itself quadratic on a pattern that is
 * mostly unclosed `[`, since every one of them restarts a scan that runs to
 * the end of the string. Guarding against ReDoS with a pattern an attacker can
 * ReDoS defeats the guard.
 */
function scanPattern(pattern: string): PatternScan {
  let bracketCount = 0;
  let nestedQuantifiers = false;
  let inClass = false;

  /** One entry per open group; true once that group's body contains `*` or `+`. */
  const groupHasQuantifier: boolean[] = [];

  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];

    if (char === "\\") {
      index++;
      continue;
    }

    if (inClass) {
      if (char === "[") {
        bracketCount++;
      } else if (char === "]") {
        inClass = false;
      }
      continue;
    }

    if (char === "[") {
      bracketCount++;
      inClass = true;
      continue;
    }

    if (char === "(") {
      groupHasQuantifier.push(false);
      continue;
    }

    if (char === ")") {
      const bodyQuantifies = groupHasQuantifier.pop();
      if (bodyQuantifies === undefined) {
        continue;
      }

      const next = pattern[index + 1];
      const groupIsQuantified = next === "*" || next === "+" || next === "?" || next === "{";

      if (bodyQuantifies && groupIsQuantified) {
        nestedQuantifiers = true;
      }

      // A quantifying group counts as a quantifier for whatever encloses it.
      if (bodyQuantifies && groupHasQuantifier.length > 0) {
        groupHasQuantifier[groupHasQuantifier.length - 1] = true;
      }

      continue;
    }

    if ((char === "*" || char === "+") && groupHasQuantifier.length > 0) {
      groupHasQuantifier[groupHasQuantifier.length - 1] = true;
    }
  }

  return { bracketCount, nestedQuantifiers };
}

/**
 * Rejects regex sources prone to catastrophic backtracking (ReDoS) before they
 * ever reach `new RegExp`. Throws {@link TaskInvalidInputError} for a pattern
 * with too many `[` characters or with nested quantifiers like `(a+)+`.
 */
export function assertSafeRegexPattern(pattern: string): void {
  const { bracketCount, nestedQuantifiers } = scanPattern(pattern);

  if (bracketCount > SECURITY_LIMITS.regexMaxBracketCount) {
    throw new TaskInvalidInputError(
      "Regex pattern rejected: too many '[' characters (potential ReDoS). " +
        "Simplify the pattern to reduce complexity."
    );
  }

  if (nestedQuantifiers) {
    throw new TaskInvalidInputError(
      "Regex pattern rejected: nested quantifiers detected (potential ReDoS). " +
        "Simplify the pattern to avoid catastrophic backtracking."
    );
  }
}
