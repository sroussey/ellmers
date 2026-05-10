/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai";
import type { Capability, ModelRecord } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import { HF_INFERENCE } from "./common/HFI_Constants";
import {
  hfInferenceWorkerRunFnSpecs,
  inferHfInferenceCapabilities,
} from "./common/HFI_Capabilities";
import type { HfInferenceModelConfig } from "./common/HFI_ModelSchema";

/** Main-thread registration (inline or worker-backed). No queue — uses direct execution. */
export class HfInferenceQueuedProvider extends createCloudProviderClass<HfInferenceModelConfig>(
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
