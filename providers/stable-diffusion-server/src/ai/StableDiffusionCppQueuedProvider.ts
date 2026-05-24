/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai";
import { AiProvider } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import {
  inferStableDiffusionCppCapabilities,
  stableDiffusionCppWorkerRunFnSpecs,
} from "./common/StableDiffusionCpp_Capabilities";
import { LOCAL_STABLE_DIFFUSION_CPP } from "./common/StableDiffusionCpp_Constants";
import type { StableDiffusionCppModelConfig } from "./common/StableDiffusionCpp_ModelSchema";

/** Main-thread registration (inline or worker-backed). */
export class StableDiffusionCppQueuedProvider extends createCloudProviderClass<StableDiffusionCppModelConfig>(
  AiProvider,
  {
    name: LOCAL_STABLE_DIFFUSION_CPP,
    displayName: "Local stable-diffusion.cpp (HTTP)",
    isLocal: true,
    supportsBrowser: true,
  }
) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferStableDiffusionCppCapabilities(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return stableDiffusionCppWorkerRunFnSpecs();
  }
}
