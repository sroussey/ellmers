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

/** One batch of substituted lines, positionally aligned with the input. */
export interface BoundedReplaceResult {
  readonly texts: readonly string[];
  readonly counts: readonly number[];
}

/**
 * Substitutes over a batch of lines under the same interruptible budget as
 * {@link createBoundedRegexMatcher}, and for the same reason: `String.replace`
 * backtracks exactly like `test` does. Measured on `/(\w|\d)*$/` against
 * `"1".repeat(n) + "!"`: 25 ms at n=20, 392 ms at n=24, 1538 ms at n=26.
 *
 * Batched for the same cost reason as well. Over 100 000 lines with `/foo/g`:
 * a bare `replace` per line runs 39 ms, one `vm` call per line ~13 650 ms, one
 * `vm` call per 512-line batch 147 ms.
 *
 * `expand` is called from inside the context, once per replaced match, and its
 * return value is what `String.replace` splices in. Keeping the substitution
 * itself in the engine is what lets `budget` cap replacements — which needs a
 * callback, so `$1` / `$&` expansion cannot be left to `replace` — without this
 * helper reimplementing where a match starts and ends. It also means no
 * per-match record outlives the call: peak memory is the output, not a
 * description of every match in the batch.
 *
 * `budget` is the number of replacements the whole run may still make; it is
 * threaded across the batch, so a line that exhausts it leaves the rest of the
 * batch copied verbatim.
 */
export function createBoundedRegexReplacer(
  regex: RegExp,
  expand: (args: unknown[]) => string,
  timeoutMs: number
): (texts: readonly string[], budget: number) => BoundedReplaceResult {
  // An `expand` that throws would otherwise surface as a timeout, since a
  // terminated script and a rejected one are the same rejection out here.
  let expandError: unknown;

  const context = createContext({
    re: regex,
    expand: (args: unknown[]): string => {
      try {
        return expand(args);
      } catch (err) {
        expandError = err;
        throw err;
      }
    },
    lines: [] as readonly string[],
    budget: 0,
    out: [] as string[],
    counts: [] as number[],
  });

  // Wrapped in a function so `remaining` is not redeclared in the context's
  // global scope on the second call.
  const script = new Script(`(function () {
  out.length = 0;
  counts.length = 0;
  let remaining = budget;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (remaining <= 0) {
      out.push(text);
      counts.push(0);
      continue;
    }
    let n = 0;
    const replaced = text.replace(re, function () {
      if (n >= remaining) return arguments[0];
      n++;
      return expand(Array.prototype.slice.call(arguments));
    });
    out.push(replaced);
    counts.push(n);
    remaining -= n;
  }
})();`);

  return (texts, budget) => {
    const scope = context as {
      lines: readonly string[];
      budget: number;
      out: string[];
      counts: number[];
    };
    scope.lines = texts;
    scope.budget = budget;
    expandError = undefined;

    try {
      script.runInContext(context, { timeout: timeoutMs });
    } catch {
      if (expandError !== undefined) {
        throw expandError;
      }
      // Deliberately not a TaskTimeoutError: that extends TaskAbortedError and
      // would report the run as aborted rather than failed by bad input.
      throw new TaskInvalidInputError(
        `Regex substitution exceeded its ${timeoutMs}ms budget for pattern /${regex.source}/ — ` +
          `the pattern backtracks catastrophically on this input. Simplify the pattern.`
      );
    }

    return { texts: [...scope.out], counts: [...scope.counts] };
  };
}
