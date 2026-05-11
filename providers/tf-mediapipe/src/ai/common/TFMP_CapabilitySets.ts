/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai/worker";

export const TFMP_TEXT_EMBEDDING = ["text.embedding"] as const satisfies readonly Capability[];
export const TFMP_TEXT_CLASSIFICATION = [
  "text.classification",
] as const satisfies readonly Capability[];
export const TFMP_TEXT_LANGUAGE_DETECTION = [
  "text.language-detection",
] as const satisfies readonly Capability[];
export const TFMP_IMAGE_CLASSIFICATION = [
  "image.classification",
] as const satisfies readonly Capability[];
export const TFMP_IMAGE_EMBEDDING = ["image.embedding"] as const satisfies readonly Capability[];
export const TFMP_IMAGE_SEGMENTATION = [
  "image.segmentation",
] as const satisfies readonly Capability[];
export const TFMP_IMAGE_OBJECT_DETECTION = [
  "image.object-detection",
] as const satisfies readonly Capability[];
export const TFMP_VISION_FACE_DETECTION = [
  "vision.face-detection",
] as const satisfies readonly Capability[];
export const TFMP_VISION_FACE_LANDMARKS = [
  "vision.face-landmarks",
] as const satisfies readonly Capability[];
export const TFMP_VISION_HAND_LANDMARKS = [
  "vision.hand-landmarks",
] as const satisfies readonly Capability[];
export const TFMP_VISION_POSE_LANDMARKS = [
  "vision.pose-landmarks",
] as const satisfies readonly Capability[];
export const TFMP_VISION_GESTURE = [
  "vision.gesture",
] as const satisfies readonly Capability[];
export const TFMP_MODEL_DOWNLOAD = ["model.download"] as const satisfies readonly Capability[];
export const TFMP_MODEL_UNLOAD = ["model.unload"] as const satisfies readonly Capability[];
export const TFMP_MODEL_SEARCH = [
  "provider.model-search",
] as const satisfies readonly Capability[];
export const TFMP_MODEL_INFO = ["provider.model-info"] as const satisfies readonly Capability[];

export const TFMP_CAPABILITY_SETS = [
  TFMP_TEXT_EMBEDDING,
  TFMP_TEXT_CLASSIFICATION,
  TFMP_TEXT_LANGUAGE_DETECTION,
  TFMP_IMAGE_CLASSIFICATION,
  TFMP_IMAGE_EMBEDDING,
  TFMP_IMAGE_SEGMENTATION,
  TFMP_IMAGE_OBJECT_DETECTION,
  TFMP_VISION_FACE_DETECTION,
  TFMP_VISION_FACE_LANDMARKS,
  TFMP_VISION_HAND_LANDMARKS,
  TFMP_VISION_POSE_LANDMARKS,
  TFMP_VISION_GESTURE,
  TFMP_MODEL_DOWNLOAD,
  TFMP_MODEL_UNLOAD,
  TFMP_MODEL_SEARCH,
  TFMP_MODEL_INFO,
] as const;
