/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai/worker";
import { TFMP_CAPABILITY_SETS } from "./TFMP_CapabilitySets";

export const TFMP_RUN_FN_SPECS = TFMP_CAPABILITY_SETS.map((serves) => ({ serves }));

export function tfmpWorkerRunFnSpecs(): readonly { readonly serves: readonly Capability[] }[] {
  return TFMP_RUN_FN_SPECS;
}

type CapabilityHints = Pick<ModelRecord, "model_id" | "provider_config" | "capabilities">;

/**
 * Heuristic capability inference for TensorFlow MediaPipe {@link ModelRecord}.
 *
 * MediaPipe ships canonical task-specific model files (e.g. `efficientdet_lite0.tflite`,
 * `gesture_recognizer.task`, `face_landmarker.task`). The model file name typically
 * encodes its specialised task. Declared capabilities (set by model-search) win;
 * fallback inspects the model_path / model name for known MediaPipe filenames.
 */
export function inferTfmpCapabilities(model: CapabilityHints): readonly Capability[] {
  const declared = (model.capabilities as readonly Capability[] | undefined) ?? [];
  if (declared.length > 0) return declared;

  const id = String(
    model.model_id ??
      (model.provider_config as { model_path?: string; model_name?: string } | undefined)
        ?.model_path ??
      (model.provider_config as { model_name?: string } | undefined)?.model_name ??
      ""
  );
  const baseName = (id.split("/").pop() ?? id).toLowerCase();

  // Hand landmarker / gesture recognizer share `hand_*` filenames.
  if (/gesture_recognizer/.test(baseName)) {
    return [
      "vision.gesture",
      "vision.hand-landmarks",
      "model.unload",
      "provider.model-info",
      "provider.model-search",
    ];
  }
  if (/hand_landmarker/.test(baseName)) {
    return [
      "vision.hand-landmarks",
      "model.unload",
      "provider.model-info",
      "provider.model-search",
    ];
  }
  if (/face_landmarker/.test(baseName)) {
    return [
      "vision.face-landmarks",
      "model.unload",
      "provider.model-info",
      "provider.model-search",
    ];
  }
  if (/face_detector|blaze_face/.test(baseName)) {
    return [
      "vision.face-detection",
      "model.unload",
      "provider.model-info",
      "provider.model-search",
    ];
  }
  if (/pose_landmarker/.test(baseName)) {
    return [
      "vision.pose-landmarks",
      "model.unload",
      "provider.model-info",
      "provider.model-search",
    ];
  }
  if (/object_detector|efficientdet|ssd_mobilenet|yolo/.test(baseName)) {
    return [
      "image.object-detection",
      "model.unload",
      "provider.model-info",
      "provider.model-search",
    ];
  }
  if (/segmenter|deeplab|selfie/.test(baseName)) {
    return [
      "image.segmentation",
      "model.unload",
      "provider.model-info",
      "provider.model-search",
    ];
  }
  if (/image_classifier|efficientnet|mobilenet/.test(baseName)) {
    return [
      "image.classification",
      "model.unload",
      "provider.model-info",
      "provider.model-search",
    ];
  }
  if (/image_embed/.test(baseName)) {
    return [
      "image.embedding",
      "model.unload",
      "provider.model-info",
      "provider.model-search",
    ];
  }
  if (/text_embed|universal_sentence_encoder|use_/.test(baseName)) {
    return [
      "text.embedding",
      "model.unload",
      "provider.model-info",
      "provider.model-search",
    ];
  }
  if (/text_classifier|bert_classifier/.test(baseName)) {
    return [
      "text.classification",
      "model.unload",
      "provider.model-info",
      "provider.model-search",
    ];
  }
  if (/language_detector/.test(baseName)) {
    return [
      "text.language-detection",
      "model.unload",
      "provider.model-info",
      "provider.model-search",
    ];
  }

  return ["provider.model-search", "provider.model-info"];
}
