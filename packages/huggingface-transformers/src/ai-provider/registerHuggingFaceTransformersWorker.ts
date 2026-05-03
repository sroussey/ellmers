/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker-only entry: registers HuggingFace Transformers task run functions on the worker server.
 * Re-exported from `@workglow/ai-provider/hf-transformers/runtime` so the main bundle does not resolve
 * `HFT_JobRunFns` / full task implementations.
 */

import { registerProviderWorker } from "@workglow/ai-provider/common";
import { HFT_PREVIEW_TASKS, HFT_STREAM_TASKS, HFT_TASKS } from "./common/HFT_JobRunFns";
import { HuggingFaceTransformersProvider } from "./HuggingFaceTransformersProvider";
import { loadTransformersSDK } from "./common/HFT_Pipeline";

export async function registerHuggingFaceTransformersWorker(): Promise<void> {
  const sdk = await loadTransformersSDK();

  (globalThis as any).__HFT__ = sdk;

  const { env } = sdk;
  env.backends!.onnx!.wasm!.proxy = true;
  await registerProviderWorker(
    (ws) =>
      new HuggingFaceTransformersProvider(
        HFT_TASKS,
        HFT_STREAM_TASKS,
        HFT_PREVIEW_TASKS
      ).registerOnWorkerServer(ws),
    "HuggingFaceTransformers"
  );
}
