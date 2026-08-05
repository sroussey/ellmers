/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaNonBoolean, JsonSchema } from "@workglow/util/schema";
import { ModelConfigSchema } from "../../model/ModelSchema";

export const TypeLanguage = (annotations: Record<string, unknown> = {}) =>
  ({
    type: "string",
    title: "Language",
    description: "The language to use",
    maxLength: 2,
    minLength: 2,
    ...annotations,
  }) as const;

export type TypeModelSemantic = "model" | `model:${string}`;

export type TTypeModel = DataPortSchemaNonBoolean & {
  readonly type: "string";
  readonly format: TypeModelSemantic;
};

export function TypeModelAsString<
  S extends TypeModelSemantic = "model",
  O extends Record<string, unknown> = Record<string, never>,
>(semantic: S = "model" as S, options: O = {} as O) {
  if (semantic !== "model" && !semantic.startsWith("model:")) {
    throw new Error("Invalid semantic value");
  }
  const taskName = semantic.startsWith("model:")
    ? semantic
        .slice(6)
        .replace(/Task$/, "")
        .replaceAll(/[A-Z]/g, (char) => " " + char.toLowerCase())
        .trim()
    : null;
  return {
    title: "Model",
    description: `The model ${taskName ? `for ${taskName} ` : "to use"}`,
    ...options,
    format: semantic,
    type: "string",
  } as const satisfies JsonSchema;
}

export function TypeModelByDetail<
  S extends TypeModelSemantic = "model",
  O extends Record<string, unknown> = Record<string, never>,
>(semantic: S = "model" as S, options: O = {} as O) {
  if (semantic !== "model" && !semantic.startsWith("model:")) {
    throw new Error("Invalid semantic value");
  }
  return {
    ...ModelConfigSchema,
    ...options,
    format: semantic,
  } as const satisfies JsonSchema;
}

export function TypeModel<
  S extends TypeModelSemantic = "model",
  O extends Record<string, unknown> = Record<string, never>,
>(semantic: S = "model" as S, options: O = {} as O) {
  return {
    oneOf: [TypeModelAsString<S, O>(semantic, options), TypeModelByDetail<S, O>(semantic, options)],
    ...options,
    format: semantic,
  } as const satisfies JsonSchema;
}

export function TypeSingleOrArray<const T extends DataPortSchemaNonBoolean>(type: T) {
  return {
    anyOf: [type, { type: "array", items: type }],
  } as const satisfies JsonSchema;
}

/**
 * A landmark point with x, y, z coordinates.
 */
export const TypeLandmark = {
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
    z: {
      type: "number",
      title: "Z Coordinate",
      description: "Z coordinate (depth)",
    },
  },
  required: ["x", "y", "z"],
  format: "point:3d:relative",
  additionalProperties: false,
} as const satisfies JsonSchema;

/**
 * A landmark point with x, y, z coordinates and visibility/presence scores.
 */
export const TypePoseLandmark = {
  ...TypeLandmark,
  properties: {
    ...TypeLandmark.properties,
    visibility: {
      type: "number",
      title: "Visibility",
      description: "Likelihood of the landmark being visible within the image",
    },
    presence: {
      type: "number",
      title: "Presence",
      description: "Likelihood of the landmark being present in the image",
    },
  },
} as const satisfies JsonSchema;

export type ImageSource = ImageBitmap | OffscreenCanvas | VideoFrame;

/**
 * Audio input schema supporting URIs and base64-encoded audio in multiple formats
 */
export const TypeAudioInput = {
  type: "string",
  title: "Audio",
  format: "audio:data-uri",
  description: "Audio as data-uri, or Blob",
} as const satisfies JsonSchema;

/**
 * Bounding box coordinates
 */
export const TypeBoundingBox = {
  type: "object",
  properties: {
    x: { type: "number", title: "X coordinate", description: "Left edge of the bounding box" },
    y: { type: "number", title: "Y coordinate", description: "Top edge of the bounding box" },
    width: { type: "number", title: "Width", description: "Width of the bounding box" },
    height: { type: "number", title: "Height", description: "Height of the bounding box" },
  },
  required: ["x", "y", "width", "height"],
  additionalProperties: false,
  title: "Bounding Box",
  description: "Bounding box coordinates",
} as const satisfies JsonSchema;

/**
 * Classification category with label and confidence score
 */
export const TypeCategory = {
  type: "object",
  properties: {
    label: { type: "string", title: "Label", description: "Category label" },
    score: {
      type: "number",
      title: "Confidence Score",
      description: "Confidence score between 0 and 1",
      minimum: 0,
      maximum: 1,
    },
  },
  required: ["label", "score"],
  additionalProperties: false,
  title: "Category",
  description: "Classification category with label and score",
} as const satisfies JsonSchema;
