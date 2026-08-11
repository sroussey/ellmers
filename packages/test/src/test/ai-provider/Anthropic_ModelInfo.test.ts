/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskOutput } from "@workglow/ai";
import { ANTHROPIC, _testOnly } from "@workglow/anthropic/ai";
import { _testOnly as runtimeTestOnly } from "@workglow/anthropic/ai-runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { ANTHROPIC_RUN_FNS, setAnthropicClientForTests } = _testOnly;

function findModelInfoRunFn(): AiProviderRunFn {
  const registration = ANTHROPIC_RUN_FNS.find(({ serves }) =>
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
    provider: ANTHROPIC,
    provider_config: { model_name: modelName, api_key: "test-key" },
    capabilities: ["text.generation", "model.info"],
    metadata: {},
  }) as never;

describe("Anthropic_ModelInfo", () => {
  let retrieved: string[];

  beforeEach(() => {
    retrieved = [];
    const fakeClient = {
      beta: {
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
      },
    };
    setAnthropicClientForTests(fakeClient);
    runtimeTestOnly.setAnthropicClientForTests?.(fakeClient);
  });

  afterEach(() => {
    setAnthropicClientForTests(undefined);
    runtimeTestOnly.setAnthropicClientForTests?.(undefined);
  });

  it("retrieves the model and emits a remote info finish on success", async () => {
    const runFn = findModelInfoRunFn();
    const model = modelConfig("claude-sonnet-5");
    let data: ModelInfoTaskOutput | undefined;
    await runFn(
      { model } as never,
      model,
      undefined as never,
      ((ev) => {
        if (ev.type === "finish") data = ev.data as ModelInfoTaskOutput;
      }) as never
    );

    expect(retrieved).toEqual(["claude-sonnet-5"]);
    expect(data?.is_remote).toBe(true);
  });

  it("throws naming the id and provider when retrieve 404s", async () => {
    const runFn = findModelInfoRunFn();
    const model = modelConfig("missing-model");
    await expect(
      runFn({ model } as never, model, undefined as never, (() => {}) as never)
    ).rejects.toThrow(/ANTHROPIC.*missing-model/i);
  });
});
