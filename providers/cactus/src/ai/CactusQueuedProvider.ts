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
  ModelRecord,
} from "@workglow/ai";
import { QueuedAiProvider } from "@workglow/ai";
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

  constructor(
    promiseRunFns?: readonly AiProviderRunFnRegistration<
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      CactusModelConfig
    >[],
    previewTasks?: Record<
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      AiProviderPreviewRunFn<any, any, CactusModelConfig>
    >
  ) {
    super(promiseRunFns, previewTasks);
  }

  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferCactusCapabilities(model);
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
