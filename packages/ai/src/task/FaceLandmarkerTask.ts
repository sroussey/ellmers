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

const modelSchema = TypeModel("model:FaceLandmarkerTask");

/**
 * A blendshape coefficient representing facial expression.
 */
const TypeBlendshape = {
  type: "object",
  properties: {
    label: {
      type: "string",
      title: "Blendshape Label",
      description: "Name of the blendshape (e.g., 'browDownLeft', 'eyeBlinkRight', etc.)",
    },
    score: {
      type: "number",
      title: "Coefficient Value",
      description: "Coefficient value for this blendshape",
    },
  },
  required: ["label", "score"],
  additionalProperties: false,
} as const;

/**
 * A 4x4 transformation matrix.
 */
const TypeTransformationMatrix = {
  type: "array",
  items: { type: "number" },
  minItems: 16,
  maxItems: 16,
  title: "Transformation Matrix",
  description: "4x4 transformation matrix for face effects rendering",
} as const;

/**
 * Detection result for a single face.
 */
const TypeFaceLandmarkerDetection = {
  type: "object",
  properties: {
    landmarks: {
      type: "array",
      items: TypeLandmark,
      title: "Landmarks",
      description: "478 facial landmarks in image coordinates",
      format: "points:3d:relative",
    },
    blendshapes: {
      type: "array",
      items: TypeBlendshape,
      title: "Blendshapes",
      description: "52 blendshape coefficients representing facial expressions",
    },
    transformationMatrix: TypeTransformationMatrix,
  },
  required: ["landmarks"],
  additionalProperties: false,
} as const;

export const FaceLandmarkerInputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema(),
    model: modelSchema,
    numFaces: {
      type: "number",
      minimum: 1,
      maximum: 10,
      default: 1,
      title: "Number of Faces",
      description: "The maximum number of faces to detect",
      "x-ui-group": "Configuration",
    },
    minFaceDetectionConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      title: "Min Face Detection Confidence",
      description: "Minimum confidence score for face detection",
      "x-ui-group": "Configuration",
    },
    minFacePresenceConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      title: "Min Face Presence Confidence",
      description: "Minimum confidence score for face presence",
      "x-ui-group": "Configuration",
    },
    minTrackingConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      title: "Min Tracking Confidence",
      description: "Minimum confidence score for face tracking",
      "x-ui-group": "Configuration",
    },
    outputFaceBlendshapes: {
      type: "boolean",
      default: false,
      title: "Output Face Blendshapes",
      description: "Whether to output blendshape coefficients for facial expressions",
      "x-ui-group": "Configuration",
    },
    outputFacialTransformationMatrixes: {
      type: "boolean",
      default: false,
      title: "Output Facial Transformation Matrix",
      description: "Whether to output transformation matrix for effects rendering",
      "x-ui-group": "Configuration",
    },
  },
  required: ["image", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const FaceLandmarkerOutputSchema = {
  type: "object",
  properties: {
    faces: {
      oneOf: [
        { type: "array", items: TypeFaceLandmarkerDetection },
        { type: "array", items: { type: "array", items: TypeFaceLandmarkerDetection } },
      ],
      title: "Face Detections",
      description: "Detected faces with landmarks, blendshapes, and transformation matrices",
    },
  },
  required: ["faces"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type FaceLandmarkerTaskInput = Omit<
  {
    numFaces?: number | undefined;
    minFaceDetectionConfidence?: number | undefined;
    minFacePresenceConfidence?: number | undefined;
    minTrackingConfidence?: number | undefined;
    outputFaceBlendshapes?: boolean | undefined;
    outputFacialTransformationMatrixes?: boolean | undefined;
    model: string | ModelConfig;
    image: string | { [x: string]: unknown };
  },
  "image"
> & { image: ImageValue };
export type FaceLandmarkerTaskOutput = {
  faces:
    | {
        blendshapes?: { score: number; label: string }[] | undefined;
        transformationMatrix?: number[] | undefined;
        landmarks: { x: number; y: number; z: number }[];
      }[]
    | {
        blendshapes?: { score: number; label: string }[] | undefined;
        transformationMatrix?: number[] | undefined;
        landmarks: { x: number; y: number; z: number }[];
      }[][];
};
export type FaceLandmarkerTaskConfig = TaskConfig<FaceLandmarkerTaskInput>;

/**
 * Detects facial landmarks and expressions in images using MediaPipe Face Landmarker.
 * Identifies 478 facial landmarks, 52 blendshape coefficients for expressions,
 * and provides transformation matrices for AR effects.
 */
export class FaceLandmarkerTask extends AiVisionTask<
  FaceLandmarkerTaskInput,
  FaceLandmarkerTaskOutput,
  FaceLandmarkerTaskConfig
> {
  public static override type = "FaceLandmarkerTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = [
    "vision.face-landmarks",
  ] as const satisfies Capability[];
  public static override category = "AI Vision";
  public static override title = "Face Landmarker";
  public static override description =
    "Detects facial landmarks and expressions in images. Identifies 478 facial landmarks, blendshapes for expressions, and transformation matrices for AR effects.";
  public static override inputSchema(): DataPortSchema {
    return FaceLandmarkerInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return FaceLandmarkerOutputSchema as DataPortSchema;
  }
}

export const faceLandmarker = (
  input: FaceLandmarkerTaskInput,
  config?: FaceLandmarkerTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new FaceLandmarkerTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    faceLandmarker: CreateWorkflow<
      FaceLandmarkerTaskInput,
      FaceLandmarkerTaskOutput,
      FaceLandmarkerTaskConfig
    >;
  }
}

Workflow.prototype.faceLandmarker = CreateWorkflow(FaceLandmarkerTask);
