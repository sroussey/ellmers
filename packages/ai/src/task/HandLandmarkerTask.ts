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
import { TypeLandmark, TypeModel } from "./base/AiTaskSchemas";
import { AiVisionTask } from "./base/AiVisionTask";

const modelSchema = TypeModel("model:HandLandmarkerTask");

/**
 * Handedness classification (left or right hand).
 */
const TypeHandedness = {
  type: "object",
  properties: {
    label: {
      type: "string",
      title: "Hand Label",
      description: "Whether the hand is 'Left' or 'Right'",
    },
    score: {
      type: "number",
      title: "Confidence Score",
      description: "Confidence score for the handedness classification",
    },
  },
  required: ["label", "score"],
  additionalProperties: false,
} as const;

/**
 * Detection result for a single hand.
 */
const TypeHandDetection = {
  type: "object",
  properties: {
    handedness: {
      type: "array",
      items: TypeHandedness,
      title: "Handedness",
      description: "Handedness classification (left/right)",
    },
    landmarks: {
      type: "array",
      items: TypeLandmark,
      title: "Landmarks",
      description: "21 hand landmarks in image coordinates",
      format: "points:3d:relative",
    },
    worldLandmarks: {
      type: "array",
      items: TypeLandmark,
      title: "World Landmarks",
      description: "21 hand landmarks in 3D world coordinates (meters)",
      format: "points:3d:meters",
    },
  },
  required: ["handedness", "landmarks", "worldLandmarks"],
  additionalProperties: false,
} as const;

export const HandLandmarkerInputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema(),
    model: modelSchema,
    numHands: {
      type: "number",
      minimum: 1,
      maximum: 10,
      default: 1,
      title: "Number of Hands",
      description: "The maximum number of hands to detect",
      "x-ui-group": "Configuration",
    },
    minHandDetectionConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      title: "Min Hand Detection Confidence",
      description: "Minimum confidence score for hand detection",
      "x-ui-group": "Configuration",
    },
    minHandPresenceConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      title: "Min Hand Presence Confidence",
      description: "Minimum confidence score for hand presence",
      "x-ui-group": "Configuration",
    },
    minTrackingConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      title: "Min Tracking Confidence",
      description: "Minimum confidence score for hand tracking",
      "x-ui-group": "Configuration",
    },
  },
  required: ["image", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const HandLandmarkerOutputSchema = {
  type: "object",
  properties: {
    hands: {
      oneOf: [
        { type: "array", items: TypeHandDetection },
        { type: "array", items: { type: "array", items: TypeHandDetection } },
      ],
      title: "Hand Detections",
      description: "Detected hands with handedness and landmarks",
    },
  },
  required: ["hands"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type HandLandmarkerTaskInput = Omit<
  {
    minTrackingConfidence?: number | undefined;
    numHands?: number | undefined;
    minHandDetectionConfidence?: number | undefined;
    minHandPresenceConfidence?: number | undefined;
    model: string | ModelConfig;
    image: string | { [x: string]: unknown };
  },
  "image"
> & { image: ImageValue };
export type HandLandmarkerTaskOutput = {
  hands:
    | {
        landmarks: { x: number; y: number; z: number }[];
        handedness: { score: number; label: string }[];
        worldLandmarks: { x: number; y: number; z: number }[];
      }[]
    | {
        landmarks: { x: number; y: number; z: number }[];
        handedness: { score: number; label: string }[];
        worldLandmarks: { x: number; y: number; z: number }[];
      }[][];
};
export type HandLandmarkerTaskConfig = TaskConfig<HandLandmarkerTaskInput>;

/**
 * Detects hand landmarks in images using MediaPipe Hand Landmarker.
 * Identifies 21 hand landmarks and classifies left vs. right hands.
 */
export class HandLandmarkerTask extends AiVisionTask<
  HandLandmarkerTaskInput,
  HandLandmarkerTaskOutput,
  HandLandmarkerTaskConfig
> {
  public static override type = "HandLandmarkerTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = [
    "vision.hand-landmarks",
  ] as const satisfies Capability[];
  public static override category = "AI Vision";
  public static override title = "Hand Landmarker";
  public static override description =
    "Detects hand landmarks in images. Identifies 21 hand landmarks and classifies left vs. right hands.";
  public static override inputSchema(): DataPortSchema {
    return HandLandmarkerInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return HandLandmarkerOutputSchema as DataPortSchema;
  }
}

export const handLandmarker = (
  input: HandLandmarkerTaskInput,
  config?: HandLandmarkerTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new HandLandmarkerTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    handLandmarker: CreateWorkflow<
      HandLandmarkerTaskInput,
      HandLandmarkerTaskOutput,
      HandLandmarkerTaskConfig
    >;
  }
}

Workflow.prototype.handLandmarker = CreateWorkflow(HandLandmarkerTask);
