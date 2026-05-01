/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { TypeImageInput, TypeModel, TypePoseLandmark } from "./base/AiTaskSchemas";
import { AiVisionTask } from "./base/AiVisionTask";

const modelSchema = TypeModel("model:PoseLandmarkerTask");

/**
 * A segmentation mask for the detected person.
 */
const TypeSegmentationMask = {
  type: "object",
  properties: {
    data: {
      type: "object",
      title: "Mask Data",
      description: "Canvas or image data containing the segmentation mask",
    },
    width: {
      type: "number",
      title: "Width",
      description: "Width of the segmentation mask",
    },
    height: {
      type: "number",
      title: "Height",
      description: "Height of the segmentation mask",
    },
  },
  required: ["data", "width", "height"],
  additionalProperties: false,
} as const;

/**
 * Detection result for a single pose.
 */
const TypePoseDetection = {
  type: "object",
  properties: {
    landmarks: {
      type: "array",
      items: TypePoseLandmark,
      title: "Landmarks",
      description: "33 pose landmarks in image coordinates",
    },
    worldLandmarks: {
      type: "array",
      items: TypePoseLandmark,
      title: "World Landmarks",
      description: "33 pose landmarks in 3D world coordinates (meters)",
    },
    segmentationMask: TypeSegmentationMask,
  },
  required: ["landmarks", "worldLandmarks"],
  additionalProperties: false,
} as const;

export const PoseLandmarkerInputSchema = {
  type: "object",
  properties: {
    image: TypeImageInput,
    model: modelSchema,
    numPoses: {
      type: "number",
      minimum: 1,
      maximum: 10,
      default: 1,
      title: "Number of Poses",
      description: "The maximum number of poses to detect",
      "x-ui-group": "Configuration",
    },
    minPoseDetectionConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      title: "Min Pose Detection Confidence",
      description: "Minimum confidence score for pose detection",
      "x-ui-group": "Configuration",
    },
    minPosePresenceConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      title: "Min Pose Presence Confidence",
      description: "Minimum confidence score for pose presence",
      "x-ui-group": "Configuration",
    },
    minTrackingConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      title: "Min Tracking Confidence",
      description: "Minimum confidence score for pose tracking",
      "x-ui-group": "Configuration",
    },
    outputSegmentationMasks: {
      type: "boolean",
      default: false,
      title: "Output Segmentation Masks",
      description: "Whether to output segmentation masks for detected poses",
      "x-ui-group": "Configuration",
    },
  },
  required: ["image", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const PoseLandmarkerOutputSchema = {
  type: "object",
  properties: {
    poses: {
      oneOf: [
        { type: "array", items: TypePoseDetection },
        { type: "array", items: { type: "array", items: TypePoseDetection } },
      ],
      title: "Pose Detections",
      description: "Detected poses with landmarks and optional segmentation masks",
    },
  },
  required: ["poses"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type PoseLandmarkerTaskInput = FromSchema<typeof PoseLandmarkerInputSchema>;
export type PoseLandmarkerTaskOutput = FromSchema<typeof PoseLandmarkerOutputSchema>;
export type PoseLandmarkerTaskConfig = TaskConfig<PoseLandmarkerTaskInput>;

/**
 * Detects pose landmarks in images using MediaPipe Pose Landmarker.
 * Identifies 33 body landmarks for pose estimation and optional segmentation.
 */
export class PoseLandmarkerTask extends AiVisionTask<
  PoseLandmarkerTaskInput,
  PoseLandmarkerTaskOutput,
  PoseLandmarkerTaskConfig
> {
  public static override type = "PoseLandmarkerTask";
  public static override category = "AI Vision";
  public static override title = "Pose Landmarker";
  public static override description =
    "Detects pose landmarks in images. Identifies 33 body landmarks for pose estimation and optional segmentation.";
  public static override inputSchema(): DataPortSchema {
    return PoseLandmarkerInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return PoseLandmarkerOutputSchema as DataPortSchema;
  }
}

/**
 * Convenience function to run pose landmark detection tasks.
 * Creates and executes a PoseLandmarkerTask with the provided input.
 * @param input The input parameters for pose landmark detection (image, model, and optional configuration)
 * @returns Promise resolving to the detected pose landmarks and optional segmentation masks
 */
export const poseLandmarker = (
  input: PoseLandmarkerTaskInput,
  config?: PoseLandmarkerTaskConfig
) => {
  return new PoseLandmarkerTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    poseLandmarker: CreateWorkflow<
      PoseLandmarkerTaskInput,
      PoseLandmarkerTaskOutput,
      PoseLandmarkerTaskConfig
    >;
  }
}

Workflow.prototype.poseLandmarker = CreateWorkflow(PoseLandmarkerTask);
