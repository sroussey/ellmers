/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { clearHftInlinePipelineCache } from "./common/HFT_InlineLifecycle";
import { HFT_PREVIEW_TASKS, HFT_RUN_FNS } from "./common/HFT_JobRunFns";
import { loadTransformersSDK } from "./common/HFT_Pipeline";
import { HuggingFaceTransformersQueuedProvider } from "./HuggingFaceTransformersQueuedProvider";

/**
 * Register HuggingFace Transformers ONNX on the **main thread** with inline execution
 * (full `@huggingface/transformers` and all task run functions in this bundle).
 *
 * **Re-exported from `@workglow/huggingface-transformers/ai-runtime`** — not from
 * `@workglow/huggingface-transformers/ai-provider` — so worker-only apps do not pull this graph.
 */
export async function registerHuggingFaceTransformersInline(
  options?: AiProviderRegisterOptions
): Promise<void> {
  const { env } = await loadTransformersSDK();
  env.backends!.onnx!.wasm!.proxy = true;
  const provider = new HuggingFaceTransformersQueuedProvider(HFT_RUN_FNS, HFT_PREVIEW_TASKS);
  const baseDispose = provider.dispose.bind(provider);
  provider.dispose = async () => {
    await clearHftInlinePipelineCache();
    await baseDispose();
  };
  await registerProviderInline(provider, "HuggingFaceTransformers", options);
}
