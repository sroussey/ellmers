/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ColorObject } from "@workglow/util/media";
import type { JsonSchema } from "@workglow/util/schema";
import { FromSchema, FromSchemaDefaultOptions, FromSchemaOptions } from "@workglow/util/schema";

const cssRgbChannelPattern = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const cssRgbAlphaPattern = "(?:0(?:\\.\\d+)?|1(?:\\.0+)?)";
const cssRgbColorPattern =
  `^rgba?\\(\\s*${cssRgbChannelPattern}\\s*,\\s*${cssRgbChannelPattern}\\s*,\\s*` +
  `${cssRgbChannelPattern}\\s*(?:,\\s*${cssRgbAlphaPattern})?\\s*\\)$`;

export const ColorSchema = (annotations: Record<string, unknown> = {}) =>
  ({
    type: "object",
    properties: {
      r: { type: "integer", minimum: 0, maximum: 255, title: "Red" },
      g: { type: "integer", minimum: 0, maximum: 255, title: "Green" },
      b: { type: "integer", minimum: 0, maximum: 255, title: "Blue" },
      a: { type: "integer", minimum: 0, maximum: 255, title: "Alpha", default: 255 },
    },
    required: ["r", "g", "b"],
    format: "color",
    additionalProperties: false,
    ...annotations,
  }) as const;

export const HexColorSchema = (annotations: Record<string, unknown> = {}) =>
  ({
    type: "string",
    format: "color",
    pattern: "^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$",
    title: "Color (hex)",
    description: "Color as a `#RRGGBB[AA]` or `#RGB[A]` hex string",
    ...annotations,
  }) as const;

export const CssRgbColorSchema = (annotations: Record<string, unknown> = {}) =>
  ({
    type: "string",
    format: "color",
    pattern: cssRgbColorPattern,
    title: "Color (RGB)",
    description: "Color as a CSS `rgb(r,g,b)` or `rgba(r,g,b,a)` string",
    ...annotations,
  }) as const;

/** Accept a {@link ColorObject}, hex string, or CSS `rgb(...)` / `rgba(...)` string. */
export const ColorValueSchema = (annotations: Record<string, unknown> = {}) =>
  ({
    oneOf: [
      ColorSchema(),
      HexColorSchema({
        title: (annotations.title as string | undefined) ?? "Color",
        description:
          (annotations.description as string | undefined) ??
          "Color as {r,g,b,a} object, `#RRGGBB[AA]` / `#RGB[A]` hex string, or CSS `rgb(...)` / `rgba(...)` string",
      }),
      CssRgbColorSchema(),
    ],
    ...annotations,
  }) as const;

// Type-only sentinel for FromSchema deserialize patterns, mirroring RawPixelBufferType.
const ColorObjectType = null as any as ColorObject;

export const ColorFromSchemaOptions = {
  ...FromSchemaDefaultOptions,
  deserialize: [
    {
      pattern: { type: "object", format: "color" },
      output: ColorObjectType,
    },
  ],
} as const satisfies FromSchemaOptions;

export type ColorFromSchemaOptions = typeof ColorFromSchemaOptions;

export type ColorFromSchema<SCHEMA extends JsonSchema> = FromSchema<SCHEMA, ColorFromSchemaOptions>;
