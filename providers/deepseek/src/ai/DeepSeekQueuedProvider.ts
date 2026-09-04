/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelEffortPolicy, ModelPricing, ModelRecord } from "@workglow/ai";
import { AiProvider } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import {
  deepSeekWorkerRunFnSpecs,
  inferDeepSeekCapabilities,
} from "./common/DeepSeek_Capabilities";
import { DEEPSEEK } from "./common/DeepSeek_Constants";
import { deepseekEffortPolicy } from "./common/DeepSeek_EffortPolicy";
import type { DeepSeekModelConfig } from "./common/DeepSeek_ModelSchema";
import { getDeepSeekModelPricing } from "./common/DeepSeek_Pricing";

/**
 * Main-thread registration shell for DeepSeek. Used both for inline mode
 * (constructed with the run-fn registrations array) and worker-backed mode
 * (constructed empty so the base class registers worker proxies). No queue is
 * created — DeepSeek uses {@link DirectExecutionStrategy}.
 */
export class DeepSeekQueuedProvider extends createCloudProviderClass<DeepSeekModelConfig>(
  AiProvider,
  {
    name: DEEPSEEK,
    displayName: "DeepSeek",
  }
) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferDeepSeekCapabilities(model);
  }

  override effortPolicy(model: DeepSeekModelConfig): ModelEffortPolicy | undefined {
    return deepseekEffortPolicy(model);
  }

  override modelPricing(model: DeepSeekModelConfig): ModelPricing | undefined {
    const modelName = (model.provider_config?.model_name as string | undefined) ?? model.model_id;
    return getDeepSeekModelPricing(modelName);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return deepSeekWorkerRunFnSpecs();
  }
}
