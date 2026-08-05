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
import { TypeModel, TypePoseLandmark } from "./base/AiTaskSchemas";
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
    image: ImageValueSchema(),
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

export type PoseLandmarkerTaskInput = Omit<
  {
    minTrackingConfidence?: number | undefined;
    numPoses?: number | undefined;
    minPoseDetectionConfidence?: number | undefined;
    minPosePresenceConfidence?: number | undefined;
    outputSegmentationMasks?: boolean | undefined;
    model: string | ModelConfig;
    image: string | { [x: string]: unknown };
  },
  "image"
> & { image: ImageValue };
export type PoseLandmarkerTaskOutput = {
  poses:
    | {
        segmentationMask?:
          { data: { [x: string]: unknown }; width: number; height: number } | undefined;
        landmarks: {
          visibility?: number | undefined;
          presence?: number | undefined;
          x: number;
          y: number;
          z: number;
        }[];
        worldLandmarks: {
          visibility?: number | undefined;
          presence?: number | undefined;
          x: number;
          y: number;
          z: number;
        }[];
      }[]
    | {
        segmentationMask?:
          { data: { [x: string]: unknown }; width: number; height: number } | undefined;
        landmarks: {
          visibility?: number | undefined;
          presence?: number | undefined;
          x: number;
          y: number;
          z: number;
        }[];
        worldLandmarks: {
          visibility?: number | undefined;
          presence?: number | undefined;
          x: number;
          y: number;
          z: number;
        }[];
      }[][];
};
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
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = [
    "vision.pose-landmarks",
  ] as const satisfies Capability[];
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

export const poseLandmarker = (
  input: PoseLandmarkerTaskInput,
  config?: PoseLandmarkerTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new PoseLandmarkerTask(config).run(input, runConfig);
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
