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
import { TypeBoundingBox, TypeModel } from "./base/AiTaskSchemas";
import { AiVisionTask } from "./base/AiVisionTask";

const modelSchema = TypeModel("model:ObjectDetectionTask");

const detectionSchema = {
  type: "object",
  properties: {
    label: {
      type: "string",
      title: "Label",
      description: "The label of the detected object",
    },
    score: {
      type: "number",
      title: "Confidence Score",
      description: "The confidence score for this detection",
      minimum: 0,
      maximum: 1,
    },
    box: TypeBoundingBox,
  },
  required: ["label", "score", "box"],
  additionalProperties: false,
} as const;

export const ObjectDetectionInputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema(),
    model: modelSchema,
    labels: {
      type: "array",
      items: {
        type: "string",
      },
      title: "Labels",
      description:
        "List of object labels to detect (optional, if provided uses zero-shot detection)",
      "x-ui-group": "Configuration",
    },
    threshold: {
      type: "number",
      title: "Threshold",
      description: "The threshold for filtering detections by score",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      "x-ui-group": "Configuration",
    },
  },
  required: ["image", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const ObjectDetectionOutputSchema = {
  type: "object",
  properties: {
    detections: {
      oneOf: [
        { type: "array", items: detectionSchema },
        { type: "array", items: { type: "array", items: detectionSchema } },
      ],
      title: "Detections",
      description: "The detected objects with their labels, scores, and bounding boxes",
    },
  },
  required: ["detections"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ObjectDetectionTaskInput = Omit<
  {
    threshold?: number | undefined;
    labels?: string[] | undefined;
    model: string | ModelConfig;
    image: string | { [x: string]: unknown };
  },
  "image"
> & { image: ImageValue };
export type ObjectDetectionTaskOutput = {
  detections:
    | {
        score: number;
        box: { x: number; y: number; width: number; height: number };
        label: string;
      }[]
    | {
        score: number;
        box: { x: number; y: number; width: number; height: number };
        label: string;
      }[][];
};
export type ObjectDetectionTaskConfig = TaskConfig<ObjectDetectionTaskInput>;

/**
 * Detects objects in images using vision models.
 * Automatically selects between regular and zero-shot detection based on whether labels are provided.
 */
export class ObjectDetectionTask extends AiVisionTask<
  ObjectDetectionTaskInput,
  ObjectDetectionTaskOutput,
  ObjectDetectionTaskConfig
> {
  public static override type = "ObjectDetectionTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = [
    "image.object-detection",
  ] as const satisfies Capability[];
  public static override category = "AI Vision";
  public static override title = "Object Detection";
  public static override description =
    "Detects objects in images using vision models. Supports zero-shot detection when labels are provided.";
  public static override inputSchema(): DataPortSchema {
    return ObjectDetectionInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return ObjectDetectionOutputSchema as DataPortSchema;
  }
}

export const objectDetection = (
  input: ObjectDetectionTaskInput,
  config?: ObjectDetectionTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new ObjectDetectionTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    objectDetection: CreateWorkflow<
      ObjectDetectionTaskInput,
      ObjectDetectionTaskOutput,
      ObjectDetectionTaskConfig
    >;
  }
}

Workflow.prototype.objectDetection = CreateWorkflow(ObjectDetectionTask);
