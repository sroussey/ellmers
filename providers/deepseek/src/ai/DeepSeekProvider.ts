/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import type { Capability, ModelEffortPolicy, ModelRecord } from "@workglow/ai/worker";
import { AiProvider } from "@workglow/ai/worker";
import {
  deepSeekWorkerRunFnSpecs,
  inferDeepSeekCapabilities,
} from "./common/DeepSeek_Capabilities";
import { DEEPSEEK } from "./common/DeepSeek_Constants";
import { deepseekEffortPolicy } from "./common/DeepSeek_EffortPolicy";
import type { DeepSeekModelConfig } from "./common/DeepSeek_ModelSchema";

/**
 * Worker-server registration for DeepSeek cloud models. Imports `AiProvider`
 * from `@workglow/ai/worker` so the SDK is only loaded in the worker.
 *
 * The class extends the {@link createCloudProviderClass} mixin (which supplies
 * `name` / `displayName` / `isLocal` / `supportsBrowser`) and adds the
 * DeepSeek-specific {@link AiProvider.inferCapabilities} and
 * {@link AiProvider.workerRunFnSpecs} overrides.
 */
export class DeepSeekProvider extends createCloudProviderClass<DeepSeekModelConfig>(AiProvider, {
  name: DEEPSEEK,
  displayName: "DeepSeek",
}) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferDeepSeekCapabilities(model);
  }

  override effortPolicy(model: DeepSeekModelConfig): ModelEffortPolicy | undefined {
    return deepseekEffortPolicy(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return deepSeekWorkerRunFnSpecs();
  }
}
