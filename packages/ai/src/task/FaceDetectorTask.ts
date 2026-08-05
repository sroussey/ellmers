/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import type { ImageValue } from "@workglow/util/media";
import { ImageValueSchema } from "@workglow/util/media";
import type { DataPortSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import type { ModelConfig } from "../model/ModelSchema";
import { TypeModel } from "./base/AiTaskSchemas";
import { AiVisionTask } from "./base/AiVisionTask";

const modelSchema = TypeModel("model:FaceDetectorTask");

/**
 * A bounding box for face detection.
 */
const TypeBoundingBox = {
  type: "object",
  properties: {
    x: {
      type: "number",
      title: "X Coordinate",
      description: "X coordinate of the top-left corner",
    },
    y: {
      type: "number",
      title: "Y Coordinate",
      description: "Y coordinate of the top-left corner",
    },
    width: {
      type: "number",
      title: "Width",
      description: "Width of the bounding box",
    },
    height: {
      type: "number",
      title: "Height",
      description: "Height of the bounding box",
    },
  },
  required: ["x", "y", "width", "height"],
  additionalProperties: false,
} as const;

/**
 * A keypoint on the face.
 */
const TypeKeypoint = {
  type: "object",
  properties: {
    x: {
      type: "number",
      title: "X Coordinate",
      description: "X coordinate normalized to [0.0, 1.0]",
    },
    y: {
      type: "number",
      title: "Y Coordinate",
      description: "Y coordinate normalized to [0.0, 1.0]",
    },
    label: {
      type: "string",
      title: "Keypoint Label",
      description: "Label for the keypoint (e.g., 'leftEye', 'rightEye', 'noseTip', etc.)",
    },
  },
  required: ["x", "y"],
  additionalProperties: false,
} as const;

/**
 * A detected face with bounding box and keypoints.
 */
const TypeFaceDetection = {
  type: "object",
  properties: {
    box: TypeBoundingBox,
    keypoints: {
      type: "array",
      items: TypeKeypoint,
      title: "Keypoints",
      description: "Facial keypoints (left eye, right eye, nose tip, mouth, left/right tragion)",
    },
    score: {
      type: "number",
      title: "Confidence Score",
      description: "Confidence score for the face detection",
    },
  },
  required: ["box", "keypoints", "score"],
  additionalProperties: false,
} as const;

export const FaceDetectorInputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema(),
    model: modelSchema,
    minDetectionConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      title: "Min Detection Confidence",
      description: "Minimum confidence score for face detection",
      "x-ui-group": "Configuration",
    },
    minSuppressionThreshold: {
      type: "number",
      minimum: 0,
      maximum: 1,
      default: 0.3,
      title: "Min Suppression Threshold",
      description: "Minimum non-maximum-suppression threshold for overlapping detections",
      "x-ui-group": "Configuration",
    },
  },
  required: ["image", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const FaceDetectorOutputSchema = {
  type: "object",
  properties: {
    faces: {
      oneOf: [
        { type: "array", items: TypeFaceDetection },
        { type: "array", items: { type: "array", items: TypeFaceDetection } },
      ],
      title: "Face Detections",
      description: "Detected faces with bounding boxes, keypoints, and confidence scores",
    },
  },
  required: ["faces"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type FaceDetectorTaskInput = Omit<
  {
    minDetectionConfidence?: number | undefined;
    minSuppressionThreshold?: number | undefined;
    model: string | ModelConfig;
    image: string | { [x: string]: unknown };
  },
  "image"
> & { image: ImageValue };
export type FaceDetectorTaskOutput = {
  faces:
    | {
        score: number;
        box: { x: number; y: number; width: number; height: number };
        keypoints: { label?: string | undefined; x: number; y: number }[];
      }[]
    | {
        score: number;
        box: { x: number; y: number; width: number; height: number };
        keypoints: { label?: string | undefined; x: number; y: number }[];
      }[][];
};
export type FaceDetectorTaskConfig = TaskConfig<FaceDetectorTaskInput>;

/**
 * Detects faces in images using MediaPipe Face Detector.
 * Locates faces and identifies facial keypoints like eyes, nose, and mouth.
 */
export class FaceDetectorTask extends AiVisionTask<
  FaceDetectorTaskInput,
  FaceDetectorTaskOutput,
  FaceDetectorTaskConfig
> {
  public static override type = "FaceDetectorTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = [
    "vision.face-detection",
  ] as const satisfies Capability[];
  public static override category = "AI Vision";
  public static override title = "Face Detector";
  public static override description =
    "Detects faces in images. Locates faces and identifies facial keypoints like eyes, nose, and mouth.";
  public static override inputSchema(): DataPortSchema {
    return FaceDetectorInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return FaceDetectorOutputSchema as DataPortSchema;
  }
}

export const faceDetector = (
  input: FaceDetectorTaskInput,
  config?: FaceDetectorTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new FaceDetectorTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    faceDetector: CreateWorkflow<
      FaceDetectorTaskInput,
      FaceDetectorTaskOutput,
      FaceDetectorTaskConfig
    >;
  }
}

Workflow.prototype.faceDetector = CreateWorkflow(FaceDetectorTask);
