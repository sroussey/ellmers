/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expectTypeOf, it } from "vitest";
import type { ModelPricing } from "../ModelSchema";

/**
 * Compile-time guard that `ModelPricing` keeps every rate as `number |
 * undefined` (never `?:`), so a rate card that omits a field is a compile
 * error rather than a silently incomplete object. A runtime test cannot
 * catch this: `import type` is erased before execution and vitest does not
 * type-check `.test.ts` files, so a plain object-literal assignment compiles
 * away to nothing no matter what `ModelPricing` looks like. `.test-d.ts`
 * files run through `tsgo -p packages/ai/tsconfig.test.json` (`bun run
 * typecheck:tests`), a real compiler pass that keeps this assertion live.
 */
describe("ModelPricing", () => {
  it("has exactly the documented shape", () => {
    expectTypeOf<ModelPricing>().toEqualTypeOf<{
      readonly currency: string;
      readonly input: number | undefined;
      readonly output: number | undefined;
      readonly cached: number | undefined;
      readonly cacheWrite: number | undefined;
      readonly cacheStoragePerHour: number | undefined;
    }>();
  });

  it("rejects a rate card that omits a rate", () => {
    // Passed as an argument rather than assigned to a named const: the
    // parameter supplies the same contextual type, so the omission is still an
    // error, without leaving a binding nothing reads. An `as ModelPricing`
    // assertion would NOT do — assertions permit a missing property, which
    // makes the directive below unused and the check vacuous.
    const acceptsPricing = (_pricing: ModelPricing): void => {};
    // @ts-expect-error `output` must be stated explicitly (as `undefined` if unreported).
    acceptsPricing({
      currency: "USD",
      input: 3,
      cached: 0.3,
      cacheWrite: 3.75,
      cacheStoragePerHour: undefined,
    });
  });
});
