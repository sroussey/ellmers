/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import type { Capability, ModelEffortPolicy, ModelRecord } from "@workglow/ai/worker";
import { AiProvider } from "@workglow/ai/worker";
import {
  anthropicWorkerRunFnSpecs,
  inferAnthropicCapabilities,
} from "./common/Anthropic_Capabilities";
import { ANTHROPIC } from "./common/Anthropic_Constants";
import { anthropicEffortPolicy } from "./common/Anthropic_EffortPolicy";
import type { AnthropicModelConfig } from "./common/Anthropic_ModelSchema";

/**
 * Worker-server registration for Anthropic cloud models. Imports `AiProvider`
 * from `@workglow/ai/worker` so the SDK is only loaded in the worker.
 *
 * The class extends the {@link createCloudProviderClass} mixin (which
 * supplies `name` / `displayName` / `isLocal` / `supportsBrowser`) and adds
 * the Anthropic-specific {@link AiProvider.inferCapabilities} and
 * {@link AiProvider.workerRunFnSpecs} overrides.
 *
 * Note: Anthropic does not offer an embeddings API.
 */
export class AnthropicProvider extends createCloudProviderClass<AnthropicModelConfig>(AiProvider, {
  name: ANTHROPIC,
  displayName: "Anthropic",
}) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferAnthropicCapabilities(model);
  }

  override effortPolicy(model: AnthropicModelConfig): ModelEffortPolicy | undefined {
    return anthropicEffortPolicy(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return anthropicWorkerRunFnSpecs();
  }
}
