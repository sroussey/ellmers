/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelEffortPolicy, ModelPricing, ModelRecord } from "@workglow/ai";
import { AiProvider } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import { inferXaiCapabilities, xaiWorkerRunFnSpecs } from "./common/Xai_Capabilities";
import { XAI } from "./common/Xai_Constants";
import { xaiEffortPolicy } from "./common/Xai_EffortPolicy";
import type { XaiModelConfig } from "./common/Xai_ModelSchema";
import { getXaiModelPricing } from "./common/Xai_Pricing";

/**
 * Main-thread registration shell for xAI. Used both for inline mode
 * (constructed with the run-fn registrations array) and worker-backed mode
 * (constructed empty so the base class registers worker proxies). No queue is
 * created — xAI uses {@link DirectExecutionStrategy}.
 */
export class XaiQueuedProvider extends createCloudProviderClass<XaiModelConfig>(AiProvider, {
  name: XAI,
  displayName: "xAI",
}) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferXaiCapabilities(model);
  }

  override effortPolicy(model: XaiModelConfig): ModelEffortPolicy | undefined {
    return xaiEffortPolicy(model);
  }

  override modelPricing(model: XaiModelConfig): ModelPricing | undefined {
    const modelName = (model.provider_config?.model_name as string | undefined) ?? model.model_id;
    return getXaiModelPricing(modelName);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return xaiWorkerRunFnSpecs();
  }
}
