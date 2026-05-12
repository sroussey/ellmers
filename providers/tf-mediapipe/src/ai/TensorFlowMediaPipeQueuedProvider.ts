/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai";
import type {
  AiProviderLegacyStreamFnRegistration,
  AiProviderPreviewRunFn,
  Capability,
  ModelRecord,
} from "@workglow/ai";
import { TENSORFLOW_MEDIAPIPE } from "./common/TFMP_Constants";
import { inferTfmpCapabilities, tfmpWorkerRunFnSpecs } from "./common/TFMP_Capabilities";
import type { TFMPModelConfig } from "./common/TFMP_ModelSchema";

/** Main-thread registration (inline or worker-backed). WASM-only — uses direct execution. */
export class TensorFlowMediaPipeQueuedProvider extends AiProvider<TFMPModelConfig> {
  readonly name = TENSORFLOW_MEDIAPIPE;
  readonly displayName = "TensorFlow MediaPipe";
  readonly isLocal = true;
  readonly supportsBrowser = true;

  constructor(
    runFns?: readonly AiProviderLegacyStreamFnRegistration<
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
    super(runFns, previewTasks);
  }

  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferTfmpCapabilities(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return tfmpWorkerRunFnSpecs();
  }
}
