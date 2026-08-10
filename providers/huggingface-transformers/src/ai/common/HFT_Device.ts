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
export function resolveHftPipelineDevice(raw: string | undefined): string | undefined {
  if (isHftBrowserEnv()) {
    if (raw === "gpu") return "webgpu";
    if (raw === "cpu") return "wasm";
    if (!raw || raw === "auto") return "webgpu";
    if (raw !== "wasm" && raw !== "webgpu") return "webgpu";
    return raw;
  }

  // On the server, resolve to undefined so onnxruntime-node defaults to the CPU
  // execution provider instead of probing CUDA (which throws when the CUDA
  // shared libraries are absent, e.g. CPU-only CI runners). "wasm" has no
  // server-side execution provider and is stripped here as well.
  //
  // "webgpu" is deliberately NOT stripped: onnxruntime-node can serve it, and a
  // local model on a GPU box is the reason to ask for it. It is passed through
  // unconditionally, so a host without a usable WebGPU adapter fails at pipeline
  // creation rather than degrading to CPU.
  if (!raw || raw === "auto" || raw === "wasm") return undefined;
  return raw;
}
