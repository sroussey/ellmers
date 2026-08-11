/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskOutput } from "@workglow/ai";
import { HF_INFERENCE, _testOnly } from "@workglow/huggingface-inference/ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { HFI_RUN_FNS } = _testOnly;

function findModelInfoRunFn(): AiProviderRunFn {
  const registration = HFI_RUN_FNS.find(({ serves }) =>
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
    provider: HF_INFERENCE,
    provider_config: { model_name: modelName, api_key: "test-token" },
    capabilities: ["text.generation", "model.info"],
    metadata: {},
  }) as never;

describe("HFI_ModelInfo", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("missing-model")) {
          return new Response(null, { status: 404 });
        }
        return new Response(JSON.stringify({ id: "org/model" }), { status: 200 });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("looks up the Hub model and emits a remote info finish on success", async () => {
    const runFn = findModelInfoRunFn();
    const model = modelConfig("org/model");
    let data: ModelInfoTaskOutput | undefined;
    await runFn(
      { model } as never,
      model,
      undefined as never,
      ((ev) => {
        if (ev.type === "finish") data = ev.data as ModelInfoTaskOutput;
      }) as never
    );

    expect(fetch).toHaveBeenCalled();
    expect(data?.is_remote).toBe(true);
  });

  it("throws naming the id and provider when Hub returns 404", async () => {
    const runFn = findModelInfoRunFn();
    const model = modelConfig("missing-model");
    await expect(
      runFn({ model } as never, model, undefined as never, (() => {}) as never)
    ).rejects.toThrow(/HF_INFERENCE.*missing-model/i);
  });
});
