/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether the host engine will actually run away on a catastrophic pattern.
 *
 * V8 backtracks until it finishes, which for `(\w|\d)*$` against forty digits is
 * on the order of days — that runaway is exactly what the grep/sed match budget
 * exists to bound, and what a test asserting the budget has to produce.
 * JavaScriptCore, which Bun runs on, caps backtracking internally: the same
 * pattern returns `false` in about half a second, so the budget is never
 * reached and the assertion has nothing to observe. The budget still guards the
 * V8 hosts the code actually ships to; the fixture simply cannot be built here.
 */
export const REGEX_BACKTRACKS_UNBOUNDED: boolean = typeof Bun === "undefined";
