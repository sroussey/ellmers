/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn } from "@workglow/ai";
import { OPENAI, _testOnly } from "@workglow/openai/ai";
import { _testOnly as runtimeTestOnly } from "@workglow/openai/ai-runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { OPENAI_RUN_FNS, setOpenAIClientForTests } = _testOnly;

function findStructuredGenerationRunFn(): AiProviderRunFn {
  const registration = OPENAI_RUN_FNS.find(
    ({ serves }) =>
      (serves as readonly string[]).includes("json-mode") &&
      (serves as readonly string[]).includes("text.generation")
  );
  expect(registration).toBeDefined();
  return registration!.runFn as AiProviderRunFn;
}

const modelConfig = () =>
  ({
    model_id: "gpt-5.5",
    title: "gpt-5.5",
    description: "",
    provider: OPENAI,
    provider_config: { model_name: "gpt-5.5", api_key: "test-key" },
    capabilities: ["text.generation", "json-mode"],
    metadata: {},
  }) as never;

/**
 * The Responses SDK returns an async-iterable of lifecycle events; the run-fn
 * only reads `type`/`delta`, so a two-event stream is enough to drive it to a
 * finish while we inspect the captured request.
 */
function fakeStream(text: string): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "response.output_text.delta", delta: text };
      yield { type: "response.completed", response: {} };
    },
  };
}

describe("OpenAI_StructuredGeneration request shape", () => {
  let created: Record<string, unknown>[];

  beforeEach(() => {
    created = [];
    const fakeClient = {
      responses: {
        create: async (params: Record<string, unknown>) => {
          created.push(params);
          return fakeStream('{"a":1}');
        },
      },
    };
    setOpenAIClientForTests(fakeClient);
    runtimeTestOnly.setOpenAIClientForTests(fakeClient);
  });

  afterEach(() => {
    setOpenAIClientForTests(undefined);
    runtimeTestOnly.setOpenAIClientForTests(undefined);
  });

  it("sends strict:false and the caller's schema when the schema cannot be made strict", async () => {
    // The Responses path always sends `json_schema`, with `strict` as a
    // variable. When the schema cannot satisfy the strict subset the request
    // must carry the schema AS THE CALLER WROTE IT — the nullable-union rewrite
    // exists only to satisfy strict mode, so shipping the rewritten type-array
    // spelling on a downshifted request would send a shape the caller never
    // asked for while buying nothing.
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["addr"],
      properties: {
        addr: {
          anyOf: [{ type: "object", properties: { city: { type: "string" } } }, { type: "null" }],
        },
      },
    };

    const runFn = findStructuredGenerationRunFn();
    const model = modelConfig();
    await runFn(
      { prompt: "hi", outputSchema: schema } as never,
      model,
      undefined as never,
      () => {}
    );

    expect(created).toHaveLength(1);
    const format = (created[0].text as { format: Record<string, unknown> }).format;
    expect(format.strict).toBe(false);
    expect(format.schema).toEqual(schema);
    // The schema also travels in the prompt, since `strict: false` is not
    // enforcement.
    expect(String(created[0].input)).toContain("JSON Schema:");
  });

  it("sends strict:true and the rewritten schema when the rewrite makes it strict", async () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["a"],
      properties: { a: { anyOf: [{ type: "number" }, { type: "null" }] } },
    };

    const runFn = findStructuredGenerationRunFn();
    const model = modelConfig();
    await runFn(
      { prompt: "hi", outputSchema: schema } as never,
      model,
      undefined as never,
      () => {}
    );

    const format = (created[0].text as { format: Record<string, unknown> }).format;
    expect(format.strict).toBe(true);
    expect(format.schema).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["a"],
      properties: { a: { type: ["number", "null"] } },
    });
    expect(created[0].input).toBe("hi");
  });
});
