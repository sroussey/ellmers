/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai";
import { AiProvider } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import {
  inferLlamaCppServerCapabilities,
  llamaCppServerWorkerRunFnSpecs,
} from "./common/LlamaCppServer_Capabilities";
import { LOCAL_LLAMACPP_SERVER } from "./common/LlamaCppServer_Constants";
import type { LlamaCppServerModelConfig } from "./common/LlamaCppServer_ModelSchema";

/** Main-thread registration (inline or worker-backed). */
export class LlamaCppServerQueuedProvider extends createCloudProviderClass<LlamaCppServerModelConfig>(
  AiProvider,
  {
    name: LOCAL_LLAMACPP_SERVER,
    displayName: "Local llama-server (HTTP)",
    isLocal: true,
    supportsBrowser: true,
  }
) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferLlamaCppServerCapabilities(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return llamaCppServerWorkerRunFnSpecs();
  }
}
