/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { RerankerTask } from "@workglow/ai";
import { describe, expect, it } from "vitest";

/**
 * Verifies #484 fix in `RerankerTask.simpleRerank`: every
 * query token is escaped before being fed to `new RegExp(token, "gi")`,
 * so user input containing regex metacharacters does not crash the task.
 *
 * Before the fix, queries like `foo(`, `\\`, `*abc`, or `[` would throw
 * `SyntaxError: Invalid regular expression` from `new RegExp`.
 */
describe("RerankerTask.simpleRerank — query token escaping", () => {
  // One row per problematic input. Each entry covers a different class of
  // regex metacharacter (group-open, escape, quantifier-leading,
  // character-class-open, mixed) plus a unicode and an empty case. The
  // empty/whitespace-only tokens are stripped upstream by the
  // `.split(/\s+/).filter(w => w.length > 0)` pipeline; we still pass them
  // here to ensure the defensive guard inside the loop tolerates them.
  const problematicQueries: ReadonlyArray<readonly [string, string]> = [
    ["unbalanced paren", "foo("],
    ["lone backslash", "\\"],
    ["leading quantifier", "*abc"],
    ["bracket open", "["],
    ["unicode token", "café"],
    ["whitespace only", "   "],
    ["empty after split", ""],
    ["mixed metas", "a.b+c?d^e$"],
  ];

  it.each(problematicQueries)(
    "does not throw for query containing %s (`%s`)",
    async (_label, query) => {
      const task = new RerankerTask();
      const chunks = ["alpha foo bar", "beta baz", "gamma qux", "delta foo("];
      const result = await task.run({ query, chunks });
      // Rerank must return a result of the same shape as the input.
      expect(result?.chunks?.length).toBe(chunks.length);
      expect(result?.scores?.length).toBe(chunks.length);
      for (const score of result?.scores ?? []) {
        expect(Number.isFinite(score)).toBe(true);
      }
    }
  );

  it("does not double-count escaped chars (`foo(` matches the literal substring)", async () => {
    const task = new RerankerTask();
    const result = await task.run({
      query: "foo(",
      chunks: ["alpha foo( bar", "no match here"],
    });
    // The first chunk should outscore the second on keyword overlap alone.
    expect(result?.scores?.[0]).toBeGreaterThan(result?.scores?.[1] ?? 0);
  });
});
