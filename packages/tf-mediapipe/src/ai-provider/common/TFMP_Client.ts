/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

let _tasksText: typeof import("@mediapipe/tasks-text") | undefined;
let _tasksVision: typeof import("@mediapipe/tasks-vision") | undefined;

export async function loadTfmpTasksTextSDK() {
  if (!_tasksText) {
    try {
      _tasksText = await import("@mediapipe/tasks-text");
    } catch {
      throw new Error(
        "@mediapipe/tasks-text is required for TensorFlow MediaPipe text (and related) tasks. Install with: bun add @mediapipe/tasks-text"
      );
    }
  }
  return _tasksText;
}

export async function loadTfmpTasksVisionSDK() {
  if (!_tasksVision) {
    try {
      _tasksVision = await import("@mediapipe/tasks-vision");
    } catch {
      throw new Error(
        "@mediapipe/tasks-vision is required for TensorFlow MediaPipe vision tasks. Install with: bun add @mediapipe/tasks-vision"
      );
    }
  }
  return _tasksVision;
}
