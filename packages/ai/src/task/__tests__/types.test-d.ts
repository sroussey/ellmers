/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FromSchema } from "@workglow/util/schema";
import { describe, expectTypeOf, it } from "vitest";
import { AiChatInputSchema, type AiChatTaskInput } from "../AiChatTask";
import { ChunkRetrievalInputSchema, type ChunkRetrievalTaskInput } from "../ChunkRetrievalTask";
import { ToolCallingInputSchema, type ToolCallingTaskInput } from "../ToolCallingTask";

describe("schema-vs-type drift guard", () => {
  it("AiChatTaskInput['prompt'] matches FromSchema resolution", () => {
    // ContentBlockSchema (the array items) is a oneOf union of the same four
    // shapes that ContentBlock describes, so the schema-derived prompt type
    // and the hand-written ContentBlock-based union must round-trip.
    expectTypeOf<AiChatTaskInput["prompt"]>().toEqualTypeOf<
      FromSchema<typeof AiChatInputSchema>["prompt"]
    >();
  });

  it("ToolCallingTaskInput['prompt'] is intentionally tighter than the schema", () => {
    // The schema's prompt-array items use `additionalProperties: true` on a
    // looser `{ type: "text" | "image" | "audio" }` shape; the runtime type
    // tightens to `ContentBlock`. The drift guard records this as one-way
    // assignability — if a new content-block kind appears in the schema
    // without showing up in ContentBlock (or vice versa), this fails.
    expectTypeOf<ToolCallingTaskInput["prompt"]>().toMatchTypeOf<
      FromSchema<typeof ToolCallingInputSchema>["prompt"]
    >();
  });

  it("ChunkRetrievalTaskInput is intentionally stricter than FromSchema (if/then/else)", () => {
    // FromSchema ignores `if/then/else`; the hand-written discriminated union
    // encodes "when query is string, model is required". Assert assignability
    // one way only, not equality.
    expectTypeOf<ChunkRetrievalTaskInput>().toMatchTypeOf<
      FromSchema<typeof ChunkRetrievalInputSchema>
    >();
  });
});
