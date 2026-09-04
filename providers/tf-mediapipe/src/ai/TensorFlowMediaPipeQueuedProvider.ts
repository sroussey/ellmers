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
  ModelPricing,
  ModelRecord,
} from "@workglow/ai";
import { AiProvider, FREE_LOCAL_PRICING } from "@workglow/ai";
import { inferTfmpCapabilities, tfmpWorkerRunFnSpecs } from "./common/TFMP_Capabilities";
import { TENSORFLOW_MEDIAPIPE } from "./common/TFMP_Constants";
import type { TFMPModelConfig } from "./common/TFMP_ModelSchema";

/** Main-thread registration (inline or worker-backed). WASM-only — uses direct execution. */
export class TensorFlowMediaPipeQueuedProvider extends AiProvider<TFMPModelConfig> {
  readonly name = TENSORFLOW_MEDIAPIPE;
  readonly displayName = "TensorFlow MediaPipe";
  readonly isLocal = true;
  readonly supportsBrowser = true;
  readonly supportsServer = false;

  constructor(
    promiseRunFns?: readonly AiProviderRunFnRegistration<any, any, TFMPModelConfig>[],
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, TFMPModelConfig>>
  ) {
    super(promiseRunFns, previewTasks);
  }

  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferTfmpCapabilities(model);
  }

  override modelPricing(model?: ModelConfig): ModelPricing | undefined {
    if (model && model.provider !== this.name) {
      return undefined;
    }
    return FREE_LOCAL_PRICING;
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return tfmpWorkerRunFnSpecs();
  }
}
