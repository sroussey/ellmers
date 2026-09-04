/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelEffortPolicy, ModelPricing, ModelRecord } from "@workglow/ai";
import { AiProvider } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import { inferOpenAiCapabilities, openAiWorkerRunFnSpecs } from "./common/OpenAI_Capabilities";
import { OPENAI } from "./common/OpenAI_Constants";
import { openaiEffortPolicy } from "./common/OpenAI_EffortPolicy";
import type { OpenAiModelConfig } from "./common/OpenAI_ModelSchema";
import { getOpenAiModelPricing } from "./common/OpenAI_Pricing";

/**
 * Main-thread registration shell for OpenAI. Used both for inline mode
 * (constructed with the run-fn registrations array) and worker-backed mode
 * (constructed empty so the base class registers worker proxies). No queue
 * is created — OpenAI uses {@link DirectExecutionStrategy}.
 */
export class OpenAiQueuedProvider extends createCloudProviderClass<OpenAiModelConfig>(AiProvider, {
  name: OPENAI,
  displayName: "OpenAI",
}) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferOpenAiCapabilities(model);
  }

  override effortPolicy(model: OpenAiModelConfig): ModelEffortPolicy | undefined {
    return openaiEffortPolicy(model);
  }

  override modelPricing(model: OpenAiModelConfig): ModelPricing | undefined {
    const modelName = (model.provider_config?.model_name as string | undefined) ?? model.model_id;
    return getOpenAiModelPricing(modelName);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return openAiWorkerRunFnSpecs();
  }
}
