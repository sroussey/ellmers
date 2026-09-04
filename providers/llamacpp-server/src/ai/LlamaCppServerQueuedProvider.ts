/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelConfig, ModelPricing, ModelRecord } from "@workglow/ai";
import { AiProvider, FREE_LOCAL_PRICING } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import {
  inferLlamaCppServerCapabilities,
  llamaCppServerWorkerRunFnSpecs,
} from "./common/LlamaCppServer_Capabilities";
import { LOCAL_LLAMACPP_SERVER } from "./common/LlamaCppServer_Constants";
import type { LlamaCppServerModelConfig } from "./common/LlamaCppServer_ModelSchema";

/** Main-thread registration (inline or worker-backed). */
export class LlamaCppServerQueuedProvider extends createCloudProviderClass<LlamaCppServerModelConfig>(
  AiProvider,
  {
    name: LOCAL_LLAMACPP_SERVER,
    displayName: "Local llama-server (HTTP)",
    isLocal: true,
    supportsBrowser: true,
  }
) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferLlamaCppServerCapabilities(model);
  }

  override modelPricing(model?: ModelConfig): ModelPricing | undefined {
    if (model && model.provider !== this.name) {
      return undefined;
    }
    return FREE_LOCAL_PRICING;
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return llamaCppServerWorkerRunFnSpecs();
  }
}
