/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

type TfmpTasksTextModule = typeof import("@mediapipe/tasks-text");
type TfmpTasksVisionModule = typeof import("@mediapipe/tasks-vision");
type TfmpTasksAudioModule = typeof import("@mediapipe/tasks-audio");
type TfmpTasksGenaiModule = typeof import("@mediapipe/tasks-genai");

let _loadPromiseText: Promise<TfmpTasksTextModule> | undefined;
let _loadPromiseVision: Promise<TfmpTasksVisionModule> | undefined;
let _loadPromiseAudio: Promise<TfmpTasksAudioModule> | undefined;
let _loadPromiseGenai: Promise<TfmpTasksGenaiModule> | undefined;

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

// NOTE: we do not want to de-dup this in the provider-utils, vite wants direct import with string literals.
export async function loadTfmpTasksAudioSDK(): Promise<TfmpTasksAudioModule> {
  _loadPromiseAudio ??= import("@mediapipe/tasks-audio").catch(() => {
    _loadPromiseAudio = undefined;
    throw new Error(
      "@mediapipe/tasks-audio is required for TensorFlow MediaPipe audio tasks. Install with: bun add @mediapipe/tasks-audio"
    );
  });
  return _loadPromiseAudio;
}

// NOTE: we do not want to de-dup this in the provider-utils, vite wants direct import with string literals.
export async function loadTfmpTasksGenaiSDK(): Promise<TfmpTasksGenaiModule> {
  _loadPromiseGenai ??= import("@mediapipe/tasks-genai").catch(() => {
    _loadPromiseGenai = undefined;
    throw new Error(
      "@mediapipe/tasks-genai is required for TensorFlow MediaPipe genai tasks. Install with: bun add @mediapipe/tasks-genai"
    );
  });
  return _loadPromiseGenai;
}
