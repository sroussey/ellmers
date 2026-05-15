/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai";
import { AiProvider } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import { inferOllamaCapabilities, ollamaWorkerRunFnSpecs } from "./common/Ollama_Capabilities";
import { OLLAMA } from "./common/Ollama_Constants";
import type { OllamaModelConfig } from "./common/Ollama_ModelSchema";

/** Main-thread registration (inline or worker-backed). No queue — uses direct execution. */
export class OllamaQueuedProvider extends createCloudProviderClass<OllamaModelConfig>(AiProvider, {
  name: OLLAMA,
  displayName: "Ollama",
  isLocal: true,
}) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferOllamaCapabilities(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return ollamaWorkerRunFnSpecs();
  }
}
