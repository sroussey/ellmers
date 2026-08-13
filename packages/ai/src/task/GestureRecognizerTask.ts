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

const modelSchema = TypeModel("model:GestureRecognizerTask");

/**
 * A recognized gesture with label and confidence score.
 */
const TypeGesture = {
  type: "object",
  properties: {
    label: {
      type: "string",
      title: "Gesture Label",
      description: "The recognized gesture (e.g., 'Thumb_Up', 'Victory', etc.)",
    },
    score: {
      type: "number",
      title: "Confidence Score",
      description: "Confidence score for the gesture",
    },
  },
  required: ["label", "score"],
  additionalProperties: false,
} as const;

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
const TypeHandGestureDetection = {
  type: "object",
  properties: {
    gestures: {
      type: "array",
      items: TypeGesture,
      title: "Gestures",
      description: "Recognized gestures for this hand",
    },
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
  required: ["gestures", "handedness", "landmarks", "worldLandmarks"],
  additionalProperties: false,
} as const;

export const GestureRecognizerInputSchema = {
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

export const GestureRecognizerOutputSchema = {
  type: "object",
  properties: {
    hands: {
      oneOf: [
        { type: "array", items: TypeHandGestureDetection },
        { type: "array", items: { type: "array", items: TypeHandGestureDetection } },
      ],
      title: "Hand Detections",
      description: "Detected hands with gestures, handedness, and landmarks",
    },
  },
  required: ["hands"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type GestureRecognizerTaskInput = Omit<
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
export type GestureRecognizerTaskOutput = {
  hands:
    | {
        landmarks: { x: number; y: number; z: number }[];
        gestures: { score: number; label: string }[];
        handedness: { score: number; label: string }[];
        worldLandmarks: { x: number; y: number; z: number }[];
      }[]
    | {
        landmarks: { x: number; y: number; z: number }[];
        gestures: { score: number; label: string }[];
        handedness: { score: number; label: string }[];
        worldLandmarks: { x: number; y: number; z: number }[];
      }[][];
};
export type GestureRecognizerTaskConfig = TaskConfig<GestureRecognizerTaskInput>;

/**
 * Recognizes hand gestures in images using MediaPipe Gesture Recognizer.
 * Detects hand landmarks, identifies gestures (like thumbs up, victory sign, etc.),
 * and classifies left vs. right hands.
 */
export class GestureRecognizerTask extends AiVisionTask<
  GestureRecognizerTaskInput,
  GestureRecognizerTaskOutput,
  GestureRecognizerTaskConfig
> {
  public static override type = "GestureRecognizerTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = ["vision.gesture"] as const satisfies Capability[];
  public static override category = "AI Vision";
  public static override title = "Gesture Recognizer";
  public static override description =
    "Recognizes hand gestures in images. Detects hand landmarks, identifies gestures (thumbs up, victory, etc.), and classifies handedness.";
  public static override inputSchema(): DataPortSchema {
    return GestureRecognizerInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return GestureRecognizerOutputSchema as DataPortSchema;
  }
}

export const gestureRecognizer = (
  input: GestureRecognizerTaskInput,
  config?: GestureRecognizerTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new GestureRecognizerTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    gestureRecognizer: CreateWorkflow<
      GestureRecognizerTaskInput,
      GestureRecognizerTaskOutput,
      GestureRecognizerTaskConfig
    >;
  }
}

Workflow.prototype.gestureRecognizer = CreateWorkflow(GestureRecognizerTask);
