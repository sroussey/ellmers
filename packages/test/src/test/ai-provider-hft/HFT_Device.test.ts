/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveHftPipelineDevice } from "@workglow/huggingface-transformers/ai-runtime";
import { afterEach, describe, expect, it } from "vitest";

describe("resolveHftPipelineDevice", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("resolves auto to undefined on the server", () => {
    expect(resolveHftPipelineDevice("auto")).toBeUndefined();
    expect(resolveHftPipelineDevice("cpu")).toBe("cpu");
    expect(resolveHftPipelineDevice("gpu")).toBe("gpu");
    expect(resolveHftPipelineDevice(undefined)).toBeUndefined();
  });

  it("strips wasm on the server but passes webgpu through", () => {
    // `wasm` has no server-side execution provider at all, so it is stripped to
    // the CPU default. `webgpu` is forwarded: onnxruntime-node can serve it, and
    // a local model run on a GPU box is the reason to ask for it.
    expect(resolveHftPipelineDevice("wasm")).toBeUndefined();
    expect(resolveHftPipelineDevice("webgpu")).toBe("webgpu");
  });

  it("defaults auto to WebGPU in the browser", () => {
    (globalThis as { window?: unknown }).window = {};

    expect(resolveHftPipelineDevice("auto")).toBe("webgpu");
    expect(resolveHftPipelineDevice(undefined)).toBe("webgpu");
    expect(resolveHftPipelineDevice("gpu")).toBe("webgpu");
    expect(resolveHftPipelineDevice("cpu")).toBe("wasm");
    expect(resolveHftPipelineDevice("wasm")).toBe("wasm");
  });
});
