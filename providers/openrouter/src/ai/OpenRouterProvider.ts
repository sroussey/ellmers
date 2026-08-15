/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import type { Capability, ModelEffortPolicy, ModelRecord } from "@workglow/ai/worker";
import { AiProvider } from "@workglow/ai/worker";
import {
  inferOpenRouterCapabilities,
  openRouterWorkerRunFnSpecs,
} from "./common/OpenRouter_Capabilities";
import { OPENROUTER } from "./common/OpenRouter_Constants";
import { openrouterEffortPolicy } from "./common/OpenRouter_EffortPolicy";
import type { OpenRouterModelConfig } from "./common/OpenRouter_ModelSchema";

/** Worker-server registration class for OpenRouter cloud models. */
export class OpenRouterProvider extends createCloudProviderClass<OpenRouterModelConfig>(
  AiProvider,
  { name: OPENROUTER, displayName: "OpenRouter" }
) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferOpenRouterCapabilities(model);
  }

  override effortPolicy(model: OpenRouterModelConfig): ModelEffortPolicy | undefined {
    return openrouterEffortPolicy(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return openRouterWorkerRunFnSpecs();
  }
}
