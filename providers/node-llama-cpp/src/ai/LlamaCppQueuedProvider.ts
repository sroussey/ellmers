/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderRunFnRegistration,
  Capability,
  ModelConfig,
  ModelRecord,
} from "@workglow/ai";
import { QueuedAiProvider } from "@workglow/ai";
import {
  inferLlamaCppCapabilities,
  llamaCppWorkerRunFnSpecs,
} from "./common/LlamaCpp_Capabilities";
import { LOCAL_LLAMACPP } from "./common/LlamaCpp_Constants";
import type { LlamaCppModelConfig } from "./common/LlamaCpp_ModelSchema";
import { deleteLlamaCppSession } from "./common/LlamaCpp_Runtime";

/** Main-thread registration (inline or worker-backed); creates the default job queue. */
export class LlamaCppQueuedProvider extends QueuedAiProvider<LlamaCppModelConfig> {
  readonly name = LOCAL_LLAMACPP;
  readonly displayName = "Local llama.cpp";
  readonly isLocal = true;
  readonly supportsBrowser = false;
  readonly supportsServer = true;

  constructor(
    promiseRunFns?: readonly AiProviderRunFnRegistration<any, any, LlamaCppModelConfig>[],
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, LlamaCppModelConfig>>
  ) {
    super(promiseRunFns, previewTasks);
  }

  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferLlamaCppCapabilities(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return llamaCppWorkerRunFnSpecs();
  }

  override createSession(_model: ModelConfig): string {
    return crypto.randomUUID();
  }

  override async disposeSession(sessionId: string): Promise<void> {
    await deleteLlamaCppSession(sessionId);
  }
}
