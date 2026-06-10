/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FromSchema } from "@workglow/util/schema";
import { describe, expectTypeOf, it } from "vitest";
import { AiChatInputSchema, type AiChatTaskInput } from "../AiChatTask";
import type {
  ContentBlock,
  ContentBlockImage,
  ContentBlockText,
  ContentBlockToolResult,
  ContentBlockToolUse,
} from "../ChatMessage";
import { ChunkRetrievalInputSchema, type ChunkRetrievalTaskInput } from "../ChunkRetrievalTask";
import { ToolCallingInputSchema, type ToolCallingTaskInput } from "../ToolCallingTask";

/**
 * Drift guard between the JSON schemas in `packages/ai/src/task/*.ts` and
 * the hand-written runtime input types alongside them. Each `it` block
 * pins one specific relationship:
 *
 * - **AiChat** — the schema's array items are `ContentBlockSchema`, so the
 *   runtime prompt type must accept all four `ContentBlock` variants. We
 *   verify each variant via positive assertions on literal samples and
 *   confirm `FromSchema` still resolves to a non-trivial type.
 *
 * - **ToolCalling** — the schema uses a looser item shape
 *   (`additionalProperties: true` on `{ type: "text" | "image" | "audio" }`),
 *   and the runtime type intentionally tightens to `ContentBlock`. The
 *   drift guard asserts the types are not equal; if they ever become equal,
 *   either the schema grew (or shrank) to match `ContentBlock` or
 *   `ContentBlock` was hollowed out and the divergence should be re-verified.
 *
 * - **ChunkRetrieval** — `FromSchema` ignores `if/then/else`, so the
 *   discriminated union the runtime type encodes is strictly tighter than
 *   the schema resolution. We assert the types are not equal; the moment
 *   they become equal, `FromSchema` has started honouring `if/then/else`
 *   (or the runtime type was loosened by hand) and the runtime type can
 *   switch to a `FromSchema`-derived form.
 */
describe("schema-vs-type drift guard", () => {
  it("AiChat: prompt accepts all four ContentBlock variants", () => {
    type TypePrompt = AiChatTaskInput["prompt"];
    // String is always allowed.
    expectTypeOf<string>().toMatchTypeOf<TypePrompt>();
    // Each ContentBlock variant flows into a readonly tuple of one element.
    const text: ContentBlockText = { type: "text", text: "hi" };
    const image: ContentBlockImage = { type: "image", mimeType: "image/png", data: "" };
    const toolUse: ContentBlockToolUse = { type: "tool_use", id: "1", name: "n", input: {} };
    const toolResult: ContentBlockToolResult = {
      type: "tool_result",
      tool_use_id: "1",
      content: [],
      is_error: undefined,
    };
    expectTypeOf<readonly [typeof text]>().toMatchTypeOf<TypePrompt>();
    expectTypeOf<readonly [typeof image]>().toMatchTypeOf<TypePrompt>();
    expectTypeOf<readonly [typeof toolUse]>().toMatchTypeOf<TypePrompt>();
    expectTypeOf<readonly [typeof toolResult]>().toMatchTypeOf<TypePrompt>();
    // And the union itself is accepted.
    expectTypeOf<readonly ContentBlock[]>().toMatchTypeOf<TypePrompt>();
    // Schema's resolved prompt type is non-trivial (drift sanity).
    expectTypeOf<FromSchema<typeof AiChatInputSchema>["prompt"]>().not.toEqualTypeOf<never>();
  });

  it("ToolCalling: prompt is intentionally divergent from FromSchema", () => {
    type SchemaPrompt = FromSchema<typeof ToolCallingInputSchema>["prompt"];
    type TypePrompt = ToolCallingTaskInput["prompt"];
    // The runtime type uses ContentBlock (4 discriminants); the schema items
    // restrict .type to "text"|"image"|"audio" + additionalProperties. They
    // are intentionally not equal — if equality returns, re-verify.
    expectTypeOf<TypePrompt>().not.toEqualTypeOf<SchemaPrompt>();
    expectTypeOf<SchemaPrompt>().not.toEqualTypeOf<never>();
    expectTypeOf<TypePrompt>().not.toEqualTypeOf<never>();
  });

  it("ChunkRetrieval: hand-written discriminated union is stricter than FromSchema", () => {
    type Schema = FromSchema<typeof ChunkRetrievalInputSchema>;
    type Runtime = ChunkRetrievalTaskInput;
    // FromSchema ignores `if/then/else`, so the schema-derived type permits
    // `{ query: string, model: undefined }` while the runtime type rejects
    // it. The two are intentionally not equal.
    expectTypeOf<Runtime>().not.toEqualTypeOf<Schema>();
    expectTypeOf<Schema>().not.toEqualTypeOf<never>();
    expectTypeOf<Runtime>().not.toEqualTypeOf<never>();
  });
});
