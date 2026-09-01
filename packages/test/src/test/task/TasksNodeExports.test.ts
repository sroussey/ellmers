/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  GrepLineMatcher,
  GrepOptions,
  SedBatchResult,
  SedLineSubstituter,
  SedOptions,
} from "@workglow/tasks";
import {
  createMatcher,
  createSedExpander,
  createSedRegex,
  createSubstituter,
  expandReplacement,
  grepLines,
  linesFromText,
  sedLines,
} from "@workglow/tasks";
import { describe, expect, test } from "vitest";

/*
 * `browser.ts` re-exports the whole grep/sed modules while the server
 * entrypoints hand-pick names, so the two surfaces drift silently: an import
 * that resolves under the browser condition fails to resolve under node, and
 * nothing notices until a CLI or Electron build breaks. Static imports are
 * deliberate — this file fails to TYPE-CHECK as well as to run when a name is
 * dropped from `node.ts` / `electron.ts`.
 */
describe("@workglow/tasks node export surface", () => {
  test("exports the grep helpers", () => {
    expect(typeof createMatcher).toBe("function");
    expect(typeof grepLines).toBe("function");
    expect(typeof linesFromText).toBe("function");
  });

  test("exports the sed helpers", () => {
    expect(typeof createSedExpander).toBe("function");
    expect(typeof createSedRegex).toBe("function");
    expect(typeof createSubstituter).toBe("function");
    expect(typeof expandReplacement).toBe("function");
    expect(typeof sedLines).toBe("function");
  });

  test("exports the grep and sed types", () => {
    const grepOptions: GrepOptions = {};
    const sedOptions: SedOptions = {};

    const matcher: GrepLineMatcher = createMatcher("foo", grepOptions);
    const substituter: SedLineSubstituter = createSubstituter("foo", "bar", sedOptions);
    const batch: SedBatchResult = substituter.substituteBatch(["foo"], 1);

    expect(matcher.matchBatch(["foo"])).toEqual([true]);
    expect(batch.texts).toEqual(["bar"]);
    expect(batch.counts).toEqual([1]);
  });
});
