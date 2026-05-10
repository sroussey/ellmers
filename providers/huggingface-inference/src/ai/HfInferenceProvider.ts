/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai/worker";
import type { Capability, ModelRecord } from "@workglow/ai/worker";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import { HF_INFERENCE } from "./common/HFI_Constants";
import {
  hfInferenceWorkerRunFnSpecs,
  inferHfInferenceCapabilities,
} from "./common/HFI_Capabilities";
import type { HfInferenceModelConfig } from "./common/HFI_ModelSchema";

/**
 * Worker-server registration for Hugging Face Inference. Imports `AiProvider`
 * from `@workglow/ai/worker` so the SDK is only loaded in the worker.
 */
export class HfInferenceProvider extends createCloudProviderClass<HfInferenceModelConfig>(
  AiProvider,
  {
    name: HF_INFERENCE,
    displayName: "Hugging Face Inference",
  }
) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferHfInferenceCapabilities(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return hfInferenceWorkerRunFnSpecs();
  }
}
