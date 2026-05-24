/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import type { Capability, ModelRecord } from "@workglow/ai/worker";
import { AiProvider } from "@workglow/ai/worker";
import {
  inferLlamaCppServerCapabilities,
  llamaCppServerWorkerRunFnSpecs,
} from "./common/LlamaCppServer_Capabilities";
import { LOCAL_LLAMACPP_SERVER } from "./common/LlamaCppServer_Constants";
import type { LlamaCppServerModelConfig } from "./common/LlamaCppServer_ModelSchema";

/**
 * Worker-server registration shell for llamacpp-server. Imports `AiProvider`
 * from `@workglow/ai/worker` so the worker module graph stays self-contained.
 *
 * Both transport and externalUrl modes are supported. The `IBackendsTransport`
 * is constructed inside the worker runtime by the caller (e.g.,
 * `MessagePortBackendsTransport` in the Builder's worker renderer) and held
 * by closure inside the run-fns — no port transfer across the worker
 * boundary. Worker registration is the primary production path; inline
 * registration (`LlamaCppServerQueuedProvider`) is primarily a testing seam.
 */
export class LlamaCppServerProvider extends createCloudProviderClass<LlamaCppServerModelConfig>(
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
