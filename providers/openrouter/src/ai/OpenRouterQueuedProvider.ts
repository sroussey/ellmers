/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai";
import { AiProvider } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import {
  inferOpenRouterCapabilities,
  openRouterWorkerRunFnSpecs,
} from "./common/OpenRouter_Capabilities";
import { OPENROUTER } from "./common/OpenRouter_Constants";
import type { OpenRouterModelConfig } from "./common/OpenRouter_ModelSchema";

/** Main-thread registration shell for OpenRouter (inline + worker-proxy). */
export class OpenRouterQueuedProvider extends createCloudProviderClass<OpenRouterModelConfig>(
  AiProvider,
  { name: OPENROUTER, displayName: "OpenRouter" }
) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferOpenRouterCapabilities(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return openRouterWorkerRunFnSpecs();
  }
}
