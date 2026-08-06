/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderRunFnRegistration,
  Capability,
  ModelConfig,
  ModelRecord,
} from "@workglow/ai/worker";
import { AiProvider } from "@workglow/ai/worker";
import { hftWorkerRunFnSpecs, inferHftCapabilities } from "./common/HFT_Capabilities";
import { HF_TRANSFORMERS_ONNX } from "./common/HFT_Constants";
import type { HfTransformersOnnxModelConfig } from "./common/HFT_ModelSchema";
import { disposeHftSessionViaRegistry } from "./common/HFT_SessionDispose";

/**
 * AI provider for HuggingFace Transformers ONNX models.
 *
 * Supports text, vision, and multimodal tasks via the `@huggingface/transformers`
 * library. Run-fn registrations are injected via the constructor so the heavy
 * `@huggingface/transformers` import is only paid in worker contexts.
 */
export class HuggingFaceTransformersProvider extends AiProvider<HfTransformersOnnxModelConfig> {
  readonly name = HF_TRANSFORMERS_ONNX;
  readonly displayName = "Hugging Face Transformers (ONNX)";
  readonly isLocal = true;
  readonly supportsBrowser = true;
  readonly supportsServer = true;

  constructor(
    promiseRunFns?: readonly AiProviderRunFnRegistration<any, any, HfTransformersOnnxModelConfig>[],
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, HfTransformersOnnxModelConfig>>
  ) {
    super(promiseRunFns, previewTasks);
  }

  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferHftCapabilities(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return hftWorkerRunFnSpecs();
  }

  override createSession(_model: ModelConfig): string {
    return crypto.randomUUID();
  }

  override async disposeSession(sessionId: string): Promise<void> {
    // Worker-side registries hold no run-fns, so this resolves to the local
    // map delete there; a registered runtime dispatches through the run-fn.
    await disposeHftSessionViaRegistry(this.name, sessionId);
  }
}
