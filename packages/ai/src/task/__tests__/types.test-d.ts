/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FromSchema } from "@workglow/util/schema";
import { describe, expectTypeOf, it } from "vitest";
import type { AiChatInputSchema } from "../AiChatTask";
import { type AiChatTaskInput } from "../AiChatTask";
import type { ChunkRetrievalInputSchema } from "../ChunkRetrievalTask";
import { type ChunkRetrievalTaskInput } from "../ChunkRetrievalTask";
import type { ToolCallingInputSchema } from "../ToolCallingTask";
import { type ToolCallingTaskInput } from "../ToolCallingTask";

/**
 * Drift guard between the JSON schemas in `packages/ai/src/task/*.ts` and
 * the hand-written runtime input types alongside them.
 *
 * - **AiChat / ToolCalling** — The runtime input types manually inline the
 *   resolved `FromSchema` literal to avoid the `json-schema-to-ts`
 *   instantiation cost on every consumer that imports the type. The cost
 *   shows up only here, in a `.test-d.ts` file excluded from
 *   `packages/ai/tsconfig.json` so the per-PR `typecheck:budget` gate never
 *   sees it. The nightly workflow runs vitest's `--typecheck` engine over
 *   this file. The moment a schema edit (e.g. adding an `audio` variant to
 *   `ContentBlockSchema`) ships without a matching literal update, the
 *   equality assertion fails and the nightly turns red.
 *
 * - **ChunkRetrieval** — `FromSchema` ignores `if/then/else`, so the
 *   discriminated union the runtime type encodes is strictly tighter than
 *   what `FromSchema` would resolve to. The non-equality assertion pins this
 *   intentional divergence; the moment they become equal, `FromSchema` has
 *   started honouring `if/then/else` and the runtime type can switch to a
 *   `FromSchema`-derived form.
 */
describe("schema-vs-type drift guard", () => {
  it("AiChat: prompt equals FromSchema resolution", () => {
    expectTypeOf<AiChatTaskInput["prompt"]>().toEqualTypeOf<
      FromSchema<typeof AiChatInputSchema>["prompt"]
    >();
  });

  it("ToolCalling: prompt equals FromSchema resolution", () => {
    expectTypeOf<ToolCallingTaskInput["prompt"]>().toEqualTypeOf<
      FromSchema<typeof ToolCallingInputSchema>["prompt"]
    >();
  });

  it("ChunkRetrieval: hand-written discriminated union is stricter than FromSchema", () => {
    type Schema = FromSchema<typeof ChunkRetrievalInputSchema>;
    type Runtime = ChunkRetrievalTaskInput;
    expectTypeOf<Runtime>().not.toEqualTypeOf<Schema>();
    expectTypeOf<Schema>().not.toEqualTypeOf<never>();
    expectTypeOf<Runtime>().not.toEqualTypeOf<never>();
  });
});
