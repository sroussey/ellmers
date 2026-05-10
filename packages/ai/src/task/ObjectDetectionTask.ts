/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import { TypeBoundingBox, TypeImageInput, TypeModel } from "./base/AiTaskSchemas";
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
    image: TypeImageInput,
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

export type ObjectDetectionTaskInput = FromSchema<typeof ObjectDetectionInputSchema>;
export type ObjectDetectionTaskOutput = FromSchema<typeof ObjectDetectionOutputSchema>;
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
  public static override readonly requires: readonly Capability[] = ["image.object-detection"] as const satisfies readonly Capability[];
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

/**
 * Convenience function to run object detection tasks.
 * Creates and executes an ObjectDetectionTask with the provided input.
 * @param input The input parameters for object detection (image, model, and optional labels)
 * @returns Promise resolving to the detected objects with labels, scores, and bounding boxes
 */
export const objectDetection = (
  input: ObjectDetectionTaskInput,
  config?: ObjectDetectionTaskConfig
) => {
  return new ObjectDetectionTask(config).run(input);
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
