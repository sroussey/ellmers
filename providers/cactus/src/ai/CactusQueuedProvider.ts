/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderRunFnRegistration,
  Capability,
  ModelConfig,
  ModelPricing,
  ModelRecord,
} from "@workglow/ai";
import { FREE_LOCAL_PRICING, QueuedAiProvider } from "@workglow/ai";
import { cactusWorkerRunFnSpecs, inferCactusCapabilities } from "./common/Cactus_Capabilities";
import { LOCAL_CACTUS } from "./common/Cactus_Constants";
import type { CactusModelConfig } from "./common/Cactus_ModelSchema";
import { deleteCactusSession } from "./common/Cactus_Runtime";

/** Main-thread registration (inline or worker-backed); creates the default job queue. */
export class CactusQueuedProvider extends QueuedAiProvider<CactusModelConfig> {
  readonly name = LOCAL_CACTUS;
  readonly displayName = "Cactus (Needle)";
  readonly isLocal = true;
  readonly supportsBrowser = true;
  readonly supportsServer = true;

  constructor(
    promiseRunFns?: readonly AiProviderRunFnRegistration<any, any, CactusModelConfig>[],
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, CactusModelConfig>>
  ) {
    super(promiseRunFns, previewTasks);
  }

  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferCactusCapabilities(model);
  }

  override modelPricing(model?: ModelConfig): ModelPricing | undefined {
    if (model && model.provider !== this.name) {
      return undefined;
    }
    return FREE_LOCAL_PRICING;
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return cactusWorkerRunFnSpecs();
  }

  override createSession(_model: ModelConfig): string {
    return crypto.randomUUID();
  }

  override async disposeSession(sessionId: string): Promise<void> {
    await deleteCactusSession(sessionId);
  }
}
