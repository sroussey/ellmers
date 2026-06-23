/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** True when running in a browser or Web Worker. */
export function isHftBrowserEnv(): boolean {
  if (typeof globalThis === "undefined") return false;
  if (typeof (globalThis as any).window !== "undefined") return true;
  if (typeof (globalThis as any).WorkerGlobalScope !== "undefined") return true;
  return false;
}

/**
 * Resolve the stored high-level HFT device into the concrete value passed to transformers.js.
 *
 * Browser builds only accept `wasm` or `webgpu`; `auto` is our cross-platform
 * stored default, and should prefer WebGPU in the browser.
 */
export function resolveHftPipelineDevice(raw: string | undefined): string {
  if (isHftBrowserEnv()) {
    if (raw === "gpu") return "webgpu";
    if (raw === "cpu") return "wasm";
    if (!raw || raw === "auto") return "webgpu";
    if (raw !== "wasm" && raw !== "webgpu") return "webgpu";
    return raw;
  }

  // On the server, let transformers.js/onnxruntime-node choose the best EP.
  if (raw === "wasm" || raw === "webgpu") return "auto";
  return raw || "auto";
}
