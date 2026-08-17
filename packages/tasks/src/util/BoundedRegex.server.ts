/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskInvalidInputError } from "@workglow/task-graph";
import { createContext, Script } from "node:vm";

/**
 * Matches lines against a regex under an interruptible wall-clock budget.
 *
 * `RegExp.prototype.test` is synchronous and uninterruptible: a catastrophic
 * pattern against one hostile line blocks the event loop indefinitely, and no
 * abort signal can reach it. V8's script-execution timeout DOES reach inside
 * Irregexp backtracking, so matching runs inside a `vm` context where a
 * `timeout` terminates it. Measured: `/(a|a)*$/` against a 40-character input
 * terminated at ~210 ms under a 200 ms budget.
 *
 * Matching is BATCHED because the `vm` hop is what costs. Over 100 000 lines
 * with `/foo/`: a bare `regex.test` per line runs 6 ms, one `vm` call per line
 * 25 051 ms (unusable), one `vm` call per 512-line batch 129 ms.
 *
 * The residual: the loop is still blocked for up to one batch budget, which is
 * bounded and finite where the unguarded call was neither. Bun honours the
 * timeout more coarsely — a 300 ms budget terminated at ~1025 ms — so treat the
 * budget as an order of magnitude, not a deadline.
 *
 * The `RegExp` is created in the calling realm and passed through the context;
 * the context is reusable after a timeout, but this returns a fresh matcher per
 * call site anyway.
 */
export function createBoundedRegexMatcher(
  regex: RegExp,
  timeoutMs: number
): (texts: readonly string[]) => boolean[] {
  const context = createContext({
    re: regex,
    lines: [] as readonly string[],
    out: [] as boolean[],
  });
  const script = new Script(
    "out.length = 0; for (let i = 0; i < lines.length; i++) out.push(re.test(lines[i]));"
  );

  return (texts) => {
    const scope = context as { lines: readonly string[]; out: boolean[] };
    scope.lines = texts;
    try {
      script.runInContext(context, { timeout: timeoutMs });
    } catch {
      // Deliberately not a TaskTimeoutError: that extends TaskAbortedError and
      // would report the run as aborted rather than failed by bad input.
      throw new TaskInvalidInputError(
        `Regex matching exceeded its ${timeoutMs}ms budget for pattern /${regex.source}/ — ` +
          `the pattern backtracks catastrophically on this input. Simplify the pattern.`
      );
    }
    return [...scope.out];
  };
}
