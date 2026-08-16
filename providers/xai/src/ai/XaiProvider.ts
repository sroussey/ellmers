/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import type { Capability, ModelEffortPolicy, ModelRecord } from "@workglow/ai/worker";
import { AiProvider } from "@workglow/ai/worker";
import { inferXaiCapabilities, xaiWorkerRunFnSpecs } from "./common/Xai_Capabilities";
import { XAI } from "./common/Xai_Constants";
import { xaiEffortPolicy } from "./common/Xai_EffortPolicy";
import type { XaiModelConfig } from "./common/Xai_ModelSchema";

/**
 * Worker-server registration for xAI cloud models. Imports `AiProvider` from
 * `@workglow/ai/worker` so the SDK is only loaded in the worker.
 *
 * The class extends the {@link createCloudProviderClass} mixin (which supplies
 * `name` / `displayName` / `isLocal` / `supportsBrowser`) and adds the
 * xAI-specific {@link AiProvider.inferCapabilities} and
 * {@link AiProvider.workerRunFnSpecs} overrides.
 */
export class XaiProvider extends createCloudProviderClass<XaiModelConfig>(AiProvider, {
  name: XAI,
  displayName: "xAI",
}) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferXaiCapabilities(model);
  }

  override effortPolicy(model: XaiModelConfig): ModelEffortPolicy | undefined {
    return xaiEffortPolicy(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return xaiWorkerRunFnSpecs();
  }
}
