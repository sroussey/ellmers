/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderWithWorker } from "@workglow/ai-provider/common";
import { HuggingFaceTransformersQueuedProvider } from "./HuggingFaceTransformersQueuedProvider";

/**
 * Register HuggingFace Transformers ONNX on the **main thread** with worker-backed execution
 * (lightweight proxy; heavy work in the worker).
 */
export async function registerHuggingFaceTransformers(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  await registerProviderWithWorker(
    new HuggingFaceTransformersQueuedProvider(),
    "HuggingFaceTransformers",
    options
  );
}
