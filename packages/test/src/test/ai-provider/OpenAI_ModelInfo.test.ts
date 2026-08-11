/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskOutput } from "@workglow/ai";
import { OPENAI, _testOnly } from "@workglow/openai/ai";
import { _testOnly as runtimeTestOnly } from "@workglow/openai/ai-runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { OPENAI_RUN_FNS, setOpenAIClientForTests } = _testOnly;

function findModelInfoRunFn(): AiProviderRunFn {
  const registration = OPENAI_RUN_FNS.find(({ serves }) =>
    (serves as readonly string[]).includes("model.info")
  );
  expect(registration).toBeDefined();
  return registration!.runFn as AiProviderRunFn;
}

const modelConfig = (modelName: string) =>
  ({
    model_id: modelName,
    title: modelName,
    description: "",
    provider: OPENAI,
    provider_config: { model_name: modelName, api_key: "test-key" },
    capabilities: ["text.generation", "model.info"],
    metadata: {},
  }) as never;

describe("OpenAI_ModelInfo", () => {
  let retrieved: string[];

  beforeEach(() => {
    retrieved = [];
    const fakeClient = {
      models: {
        retrieve: async (id: string) => {
          retrieved.push(id);
          if (id === "missing-model") {
            const err = new Error("Not Found") as Error & { status: number };
            err.status = 404;
            throw err;
          }
          return { id };
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

  it("retrieves the model and emits a remote info finish on success", async () => {
    const runFn = findModelInfoRunFn();
    const model = modelConfig("gpt-5.5");
    let data: ModelInfoTaskOutput | undefined;
    await runFn(
      { model } as never,
      model,
      undefined as never,
      ((ev) => {
        if (ev.type === "finish") data = ev.data as ModelInfoTaskOutput;
      }) as never
    );

    expect(retrieved).toEqual(["gpt-5.5"]);
    expect(data?.is_remote).toBe(true);
    expect(data?.is_local).toBe(false);
    expect(data?.is_cached).toBe(false);
  });

  it("throws naming the id and provider when retrieve 404s", async () => {
    const runFn = findModelInfoRunFn();
    const model = modelConfig("missing-model");
    await expect(
      runFn({ model } as never, model, undefined as never, (() => {}) as never)
    ).rejects.toThrow(/OpenAI.*missing-model/i);
  });

  it("verifies before attaching embedding dimensions", async () => {
    const runFn = findModelInfoRunFn();
    const model = modelConfig("text-embedding-3-small");
    let data: ModelInfoTaskOutput | undefined;
    await runFn(
      { model, detail: "dimensions" } as never,
      model,
      undefined as never,
      ((ev) => {
        if (ev.type === "finish") data = ev.data as ModelInfoTaskOutput;
      }) as never
    );

    expect(retrieved).toEqual(["text-embedding-3-small"]);
    expect(data?.native_dimensions).toBe(1536);
    expect(data?.mrl).toBe(true);
  });
});
