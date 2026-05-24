/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import type { Capability, ModelRecord } from "@workglow/ai/worker";
import { AiProvider } from "@workglow/ai/worker";
import {
  inferStableDiffusionCppCapabilities,
  stableDiffusionCppWorkerRunFnSpecs,
} from "./common/StableDiffusionCpp_Capabilities";
import { LOCAL_STABLE_DIFFUSION_CPP } from "./common/StableDiffusionCpp_Constants";
import type { StableDiffusionCppModelConfig } from "./common/StableDiffusionCpp_ModelSchema";

/**
 * Worker-server registration shell for stable-diffusion.cpp.
 *
 * Both transport and externalUrl modes are supported. The `IBackendsTransport`
 * is constructed inside the worker runtime by the caller and held by closure
 * inside the run-fns — no port transfer across the worker boundary.
 * Worker registration is the primary production path; inline registration
 * (`StableDiffusionCppQueuedProvider`) is primarily a testing seam.
 */
export class StableDiffusionCppProvider extends createCloudProviderClass<StableDiffusionCppModelConfig>(
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
