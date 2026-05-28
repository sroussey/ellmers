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
} from "@workglow/ai/worker";
import { AiProvider } from "@workglow/ai/worker";
import { cactusWorkerRunFnSpecs, inferCactusCapabilities } from "./common/Cactus_Capabilities";
import { LOCAL_CACTUS } from "./common/Cactus_Constants";
import type { CactusModelConfig } from "./common/Cactus_ModelSchema";
import { deleteCactusSession } from "./common/Cactus_Runtime.browser";

/** Browser worker-server registration for Cactus. */
export class CactusProvider extends AiProvider<CactusModelConfig> {
  readonly name = LOCAL_CACTUS;
  readonly displayName = "Cactus (Needle)";
  readonly isLocal = true;
  readonly supportsBrowser = true;
  readonly supportsServer = true;

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
