/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai/worker";
import type { AiProviderPreviewRunFn, AiProviderRunFn } from "@workglow/ai/worker";
import { TENSORFLOW_MEDIAPIPE, TFMP_DEFAULT_TASK_TYPES } from "./common/TFMP_Constants";
import type { TFMPModelConfig } from "./common/TFMP_ModelSchema";

/**
 * AI provider for TensorFlow MediaPipe models.
 *
 * Task run functions are injected via the constructor so that the heavy
 * `@mediapipe/*` libraries are only pulled in where actually needed
 * (inline mode, worker server), not on the main thread in worker mode.
 * Use `loadTfmpTasksTextSDK` / `loadTfmpTasksVisionSDK` for cached dynamic imports.

 */
export class TensorFlowMediaPipeProvider extends AiProvider<TFMPModelConfig> {
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
