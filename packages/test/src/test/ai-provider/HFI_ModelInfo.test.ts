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

/** Run the model.info run-fn, discarding the emitted event. */
async function runModelInfo(modelName: string): Promise<ModelInfoTaskOutput | undefined> {
  const runFn = findModelInfoRunFn();
  const model = modelConfig(modelName);
  let data: ModelInfoTaskOutput | undefined;
  await runFn({ model }, model, undefined as never, (ev) => {
    if (ev.type === "finish") data = ev.data as ModelInfoTaskOutput;
  });
  return data;
}

describe("HFI_ModelInfo", () => {
  let status = 200;

  beforeEach(() => {
    status = 200;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("missing-model")) {
          return new Response(null, { status: 404 });
        }
        if (status !== 200) {
          return new Response(null, { status });
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
    await runFn({ model }, model, undefined as never, (ev) => {
      if (ev.type === "finish") data = ev.data as ModelInfoTaskOutput;
    });

    expect(fetch).toHaveBeenCalled();
    expect(data?.is_remote).toBe(true);
  });

  it("throws naming the id and provider when Hub returns 404", async () => {
    const runFn = findModelInfoRunFn();
    const model = modelConfig("missing-model");
    await expect(runFn({ model }, model, undefined as never, (() => {}) as never)).rejects.toThrow(
      /HF_INFERENCE.*missing-model/i
    );
  });

  // The `/` in a namespaced id is a path separator. Encoding the whole id sends
  // `org%2Fmodel`, which the Hub answers 400 — every namespaced model id (i.e.
  // nearly all of them) fails its existence check before generation starts.
  it("requests the namespaced id as two path segments, never as %2F", async () => {
    await runModelInfo("org/model");

    expect(fetch).toHaveBeenCalledTimes(1);
    const requested = String(vi.mocked(fetch).mock.calls[0]![0]);
    expect(requested).toBe("https://huggingface.co/api/models/org/model");
    expect(requested).not.toContain("%2F");
  });

  // A 4xx that is not 404 means the request was rejected, not that the model is
  // missing. Reporting it as a generic "lookup failed" is what hid the %2F bug.
  it("distinguishes a 4xx rejection from a failed lookup", async () => {
    status = 400;
    const error = await runModelInfo("org/model").catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/rejected by the Hugging Face API \(400\)/);
    expect((error as Error).message).not.toMatch(/lookup failed/);
  });

  it("still reports a 5xx as a lookup failure", async () => {
    status = 503;
    await expect(runModelInfo("org/model")).rejects.toThrow(/lookup failed.*503/);
  });

  // Validate before spending a request: a three-segment id or a traversal
  // segment is not a repo id, and encoding it per segment would silently build
  // a URL pointing somewhere else under /api.
  it.each([["a/b/c"], ["org/.."], ["../../etc/passwd"], ["org/model?full=true"]])(
    "rejects the malformed id %s without calling fetch",
    async (modelName) => {
      await expect(runModelInfo(modelName)).rejects.toThrow(/is not a valid Hugging Face repo id/);
      expect(fetch).not.toHaveBeenCalled();
    }
  );
});
