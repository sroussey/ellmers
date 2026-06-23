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

  it("passes auto through on the server", () => {
    expect(resolveHftPipelineDevice("auto")).toBe("auto");
    expect(resolveHftPipelineDevice("cpu")).toBe("cpu");
    expect(resolveHftPipelineDevice("gpu")).toBe("gpu");
    expect(resolveHftPipelineDevice(undefined)).toBe("auto");
  });

  it("normalizes browser-only devices to auto on the server", () => {
    expect(resolveHftPipelineDevice("webgpu")).toBe("auto");
    expect(resolveHftPipelineDevice("wasm")).toBe("auto");
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
