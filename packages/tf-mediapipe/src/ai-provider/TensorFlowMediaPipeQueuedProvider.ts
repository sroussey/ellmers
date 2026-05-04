/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai";
import type { AiProviderPreviewRunFn, AiProviderRunFn } from "@workglow/ai";
import { TENSORFLOW_MEDIAPIPE, TFMP_DEFAULT_TASK_TYPES } from "./common/TFMP_Constants";
import type { TFMPModelConfig } from "./common/TFMP_ModelSchema";

/** Main-thread registration (inline or worker-backed). WASM-only — uses direct execution. */
export class TensorFlowMediaPipeQueuedProvider extends AiProvider<TFMPModelConfig> {
  readonly name = TENSORFLOW_MEDIAPIPE;
  readonly displayName = "TensorFlow MediaPipe";
  readonly isLocal = true;
  readonly supportsBrowser = true;

  readonly taskTypes: readonly string[] = TFMP_DEFAULT_TASK_TYPES;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, TFMPModelConfig>>,
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, TFMPModelConfig>>
  ) {
    super(tasks, undefined, previewTasks);
  }
}
