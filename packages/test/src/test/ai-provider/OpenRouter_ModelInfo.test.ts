/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskOutput } from "@workglow/ai";
import { OPENROUTER, _testOnly } from "@workglow/openrouter/ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { OPENROUTER_RUN_FNS } = _testOnly;

function findModelInfoRunFn(): AiProviderRunFn {
  const registration = OPENROUTER_RUN_FNS.find(({ serves }) =>
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
    provider: OPENROUTER,
    provider_config: { model_name: modelName, api_key: "test-key" },
    capabilities: ["text.generation", "model.info"],
    metadata: {},
  }) as never;

describe("OpenRouter_ModelInfo", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            data: [{ id: "anthropic/claude-sonnet-4" }, { id: "openai/gpt-5" }],
          }),
          { status: 200 }
        );
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exact-matches the live catalog and emits a remote info finish", async () => {
    const runFn = findModelInfoRunFn();
    const model = modelConfig("anthropic/claude-sonnet-4");
    let data: ModelInfoTaskOutput | undefined;
    await runFn({ model }, model, undefined as never, (ev) => {
      if (ev.type === "finish") data = ev.data as ModelInfoTaskOutput;
    });

    expect(fetch).toHaveBeenCalled();
    expect(data?.is_remote).toBe(true);
  });

  it("throws when the id is absent from the live catalog (not FALLBACK)", async () => {
    const runFn = findModelInfoRunFn();
    const model = modelConfig("missing/model");
    await expect(runFn({ model }, model, undefined as never, (() => {}) as never)).rejects.toThrow(
      /OPENROUTER.*missing\/model/i
    );
  });

  it("throws when the catalog request fails instead of using FALLBACK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 }))
    );
    const runFn = findModelInfoRunFn();
    const model = modelConfig("openai/gpt-5");
    await expect(runFn({ model }, model, undefined as never, (() => {}) as never)).rejects.toThrow(
      /OPENROUTER.*503/i
    );
  });
});
