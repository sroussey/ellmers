/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expectTypeOf, it } from "vitest";
import type { StreamEvent, StreamUsage, Usage } from "../StreamTypes";

/**
 * Compile-time guard that `StreamUsage` stays a member of the `StreamEvent`
 * union with its documented shape (`{ type: "usage"; usage: Usage }`).
 *
 * A runtime `it("is assignable to the StreamEvent union", ...)` cannot catch
 * a shape regression here: `packages/task-graph/tsconfig.json` excludes
 * `__tests__`/`*.test.ts` from type-checking, and `import type` is erased at
 * runtime, so a plain assignment compiles away to nothing and the test can
 * never fail no matter what `StreamUsage` looks like. `.test-d.ts` files run
 * through `tsc -p packages/task-graph/tsconfig.test.json` (`bun run
 * typecheck:tests`), a real compiler pass that keeps these assertions live.
 */
describe("StreamUsage in the StreamEvent union", () => {
  it("StreamUsage is assignable to StreamEvent", () => {
    expectTypeOf<StreamUsage>().toMatchTypeOf<StreamEvent>();
  });

  it('StreamEvent narrows to StreamUsage on type === "usage"', () => {
    expectTypeOf<Extract<StreamEvent, { type: "usage" }>>().toEqualTypeOf<StreamUsage>();
  });

  it("StreamUsage has exactly the documented shape", () => {
    expectTypeOf<StreamUsage>().toEqualTypeOf<{ type: "usage"; usage: Usage }>();
  });
});
