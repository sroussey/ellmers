/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai/worker";
import type {
  AiProviderPreviewRunFn,
  AiProviderRunFnRegistration,
  Capability,
  ModelRecord,
} from "@workglow/ai/worker";
import { TENSORFLOW_MEDIAPIPE } from "./common/TFMP_Constants";
import { inferTfmpCapabilities, tfmpWorkerRunFnSpecs } from "./common/TFMP_Capabilities";
import type { TFMPModelConfig } from "./common/TFMP_ModelSchema";

/**
 * Worker-server registration for TensorFlow MediaPipe. Imports `AiProvider`
 * from `@workglow/ai/worker` so the SDK is only loaded in the worker.
 */
export class TensorFlowMediaPipeProvider extends AiProvider<TFMPModelConfig> {
  readonly name = TENSORFLOW_MEDIAPIPE;
  readonly displayName = "TensorFlow MediaPipe";
  readonly isLocal = true;
  readonly supportsBrowser = true;

  constructor(
    promiseRunFns?: readonly AiProviderRunFnRegistration<
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      TFMPModelConfig
    >[],
    previewTasks?: Record<
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      AiProviderPreviewRunFn<any, any, TFMPModelConfig>
    >
  ) {
    super(promiseRunFns, previewTasks);
  }

  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferTfmpCapabilities(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return tfmpWorkerRunFnSpecs();
  }
}
