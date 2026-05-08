/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerHuggingFaceTransformersWorker } from "@workglow/huggingface-transformers/ai-runtime";

async function initHftWorkerEnv(): Promise<void> {
  const { env } = await import("@huggingface/transformers");
  const onnx = env?.backends?.onnx;
  if (onnx) {
    onnx.wasm!.proxy = true;
  }
}

await initHftWorkerEnv();
registerHuggingFaceTransformersWorker();
