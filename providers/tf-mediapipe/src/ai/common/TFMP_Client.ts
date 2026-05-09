/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

type TfmpTasksTextModule = typeof import("@mediapipe/tasks-text");
type TfmpTasksVisionModule = typeof import("@mediapipe/tasks-vision");

let _loadPromiseText: Promise<TfmpTasksTextModule> | undefined;
let _loadPromiseVision: Promise<TfmpTasksVisionModule> | undefined;

// NOTE: we do not want to de-dup this in the provider-utils, vite wants direct import with string literals.
export async function loadTfmpTasksTextSDK(): Promise<TfmpTasksTextModule> {
  _loadPromiseText ??= import("@mediapipe/tasks-text").catch(() => {
    _loadPromiseText = undefined;
    throw new Error(
      "@mediapipe/tasks-text is required for TensorFlow MediaPipe text (and related) tasks. Install with: bun add @mediapipe/tasks-text"
    );
  });
  return _loadPromiseText;
}

// NOTE: we do not want to de-dup this in the provider-utils, vite wants direct import with string literals.
export async function loadTfmpTasksVisionSDK(): Promise<TfmpTasksVisionModule> {
  _loadPromiseVision ??= import("@mediapipe/tasks-vision").catch(() => {
    _loadPromiseVision = undefined;
    throw new Error(
      "@mediapipe/tasks-vision is required for TensorFlow MediaPipe vision tasks. Install with: bun add @mediapipe/tasks-vision"
    );
  });
  return _loadPromiseVision;
}
