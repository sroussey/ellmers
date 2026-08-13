/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskOutput } from "@workglow/ai";
import { GOOGLE_GEMINI, _testOnly } from "@workglow/google-gemini/ai";
import { _testOnly as runtimeTestOnly } from "@workglow/google-gemini/ai-runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { GEMINI_RUN_FNS, setGeminiClientForTests } = _testOnly;

function findModelInfoRunFn(): AiProviderRunFn {
  const registration = GEMINI_RUN_FNS.find(({ serves }) =>
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
    provider: GOOGLE_GEMINI,
    provider_config: { model_name: modelName, api_key: "test-key" },
    capabilities: ["text.generation", "model.info"],
    metadata: {},
  }) as never;

describe("Gemini_ModelInfo", () => {
  let retrieved: string[];

  beforeEach(() => {
    retrieved = [];
    const fakeClient = {
      models: {
        get: async (params: { model: string }) => {
          retrieved.push(params.model);
          if (params.model === "missing-model") {
            const err = new Error("Not Found") as Error & { status: number };
            err.status = 404;
            throw err;
          }
          return { name: params.model };
        },
      },
    } as never;
    setGeminiClientForTests(fakeClient);
    runtimeTestOnly.setGeminiClientForTests(fakeClient);
  });

  afterEach(() => {
    setGeminiClientForTests(undefined);
    runtimeTestOnly.setGeminiClientForTests(undefined);
  });

  it("gets the model and emits a remote info finish on success", async () => {
    const runFn = findModelInfoRunFn();
    const model = modelConfig("gemini-3-flash-preview");
    let data: ModelInfoTaskOutput | undefined;
    await runFn({ model }, model, undefined as never, (ev) => {
      if (ev.type === "finish") data = ev.data as ModelInfoTaskOutput;
    });

    expect(retrieved).toEqual(["gemini-3-flash-preview"]);
    expect(data?.is_remote).toBe(true);
  });

  it("throws naming the id and provider when get 404s", async () => {
    const runFn = findModelInfoRunFn();
    const model = modelConfig("missing-model");
    await expect(runFn({ model }, model, undefined as never, (() => {}) as never)).rejects.toThrow(
      /GOOGLE_GEMINI.*missing-model/i
    );
  });
});
