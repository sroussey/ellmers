/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export type TfmpDelegate = "CPU" | "GPU";

/**
 * Resolve the stored high-level `gpu` flag (default true) into the concrete
 * MediaPipe `baseOptions.delegate` for a task engine.
 *
 * - vision: GPU delegate unless `gpu` is explicitly false.
 * - text/audio: MediaPipe web runs these tasks on CPU only; never set a delegate.
 * - genai: WebGPU is managed by the genai runtime (`gpuOptions.device`), not via
 *   the delegate option.
 */
export function resolveTfmpDelegate(
  task_engine: string,
  gpu: boolean | undefined
): TfmpDelegate | undefined {
  if (task_engine === "vision") {
    return gpu === false ? "CPU" : "GPU";
  }
  return undefined;
}
