/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelEffortPolicy, ModelPricing, ModelRecord } from "@workglow/ai";
import { AiProvider } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import {
  anthropicWorkerRunFnSpecs,
  inferAnthropicCapabilities,
} from "./common/Anthropic_Capabilities";
import { ANTHROPIC } from "./common/Anthropic_Constants";
import { anthropicEffortPolicy } from "./common/Anthropic_EffortPolicy";
import type { AnthropicModelConfig } from "./common/Anthropic_ModelSchema";
import { getAnthropicModelPricing } from "./common/Anthropic_Pricing";

/**
 * Main-thread registration shell for Anthropic. Used both for inline mode
 * (constructed with the run-fn registrations array) and worker-backed mode
 * (constructed empty so the base class registers worker proxies).
 *
 * No queue is created — Anthropic uses {@link DirectExecutionStrategy}.
 *
 * Note: Anthropic does not offer an embeddings API.
 */
export class AnthropicQueuedProvider extends createCloudProviderClass<AnthropicModelConfig>(
  AiProvider,
  {
    name: ANTHROPIC,
    displayName: "Anthropic",
  }
) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferAnthropicCapabilities(model);
  }

  override effortPolicy(model: AnthropicModelConfig): ModelEffortPolicy | undefined {
    return anthropicEffortPolicy(model);
  }

  override modelPricing(model: AnthropicModelConfig): ModelPricing | undefined {
    const modelName = (model.provider_config?.model_name as string | undefined) ?? model.model_id;
    return getAnthropicModelPricing(modelName);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return anthropicWorkerRunFnSpecs();
  }
}
