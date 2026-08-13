/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import type { Capability, ModelEffortPolicy, ModelRecord } from "@workglow/ai/worker";
import { AiProvider } from "@workglow/ai/worker";
import { inferOpenAiCapabilities, openAiWorkerRunFnSpecs } from "./common/OpenAI_Capabilities";
import { OPENAI } from "./common/OpenAI_Constants";
import { openaiEffortPolicy } from "./common/OpenAI_EffortPolicy";
import type { OpenAiModelConfig } from "./common/OpenAI_ModelSchema";

/**
 * Worker-server registration for OpenAI cloud models. Imports `AiProvider`
 * from `@workglow/ai/worker` so the SDK is only loaded in the worker.
 *
 * The class extends the {@link createCloudProviderClass} mixin (which
 * supplies `name` / `displayName` / `isLocal` / `supportsBrowser`) and adds
 * the OpenAI-specific {@link AiProvider.inferCapabilities} and
 * {@link AiProvider.workerRunFnSpecs} overrides.
 */
export class OpenAiProvider extends createCloudProviderClass<OpenAiModelConfig>(AiProvider, {
  name: OPENAI,
  displayName: "OpenAI",
}) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferOpenAiCapabilities(model);
  }

  override effortPolicy(model: OpenAiModelConfig): ModelEffortPolicy | undefined {
    return openaiEffortPolicy(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return openAiWorkerRunFnSpecs();
  }
}
