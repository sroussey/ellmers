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
import { deleteHftSession } from "./common/HFT_Pipeline";

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

  constructor(
    promiseRunFns?: readonly AiProviderRunFnRegistration<
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      HfTransformersOnnxModelConfig
    >[],
    previewTasks?: Record<
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      AiProviderPreviewRunFn<any, any, HfTransformersOnnxModelConfig>
    >
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
    deleteHftSession(sessionId);
  }
}
