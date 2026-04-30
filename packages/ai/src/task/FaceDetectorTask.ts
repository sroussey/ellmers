/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { TypeImageInput, TypeModel } from "./base/AiTaskSchemas";
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
    image: TypeImageInput,
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

export type FaceDetectorTaskInput = FromSchema<typeof FaceDetectorInputSchema>;
export type FaceDetectorTaskOutput = FromSchema<typeof FaceDetectorOutputSchema>;
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

/**
 * Convenience function to run face detection tasks.
 * Creates and executes a FaceDetectorTask with the provided input.
 * @param input The input parameters for face detection (image, model, and optional configuration)
 * @returns Promise resolving to the detected faces with bounding boxes and keypoints
 */
export const faceDetector = (input: FaceDetectorTaskInput, config?: FaceDetectorTaskConfig) => {
  return new FaceDetectorTask(config).run(input);
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
