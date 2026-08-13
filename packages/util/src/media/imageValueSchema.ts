/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

import type { PropertySchema } from "../schema-entry";
import type { ImageValue } from "./imageValue";

export type WithImageValuePorts<
  SchemaInput extends object,
  ImagePorts extends Partial<
    Record<keyof SchemaInput, ImageValue | readonly ImageValue[] | undefined>
  >,
> = Omit<SchemaInput, Extract<keyof ImagePorts, keyof SchemaInput>> & ImagePorts;

/**
 * Schema annotation for `ImageValue` ports. Multi-type form so the
 * validator accepts the wire forms an `ImageValue` port may receive
 * before hydration: `string` (data: URI), `object` (Blob, ImageBitmap, an
 * ImageValue, or a `Buffer`-like). The `format: "image"` annotation drives
 * the input resolver.
 */
export const ImageValueSchemaDefault = {
  oneOf: [
    {
      type: "string",
      format: "image:data-uri",
    },
    {
      type: "object",
      format: "image",
    },
  ],
  title: "Image",
  description: "Image",
  format: "image",
} as const satisfies PropertySchema;

export function ImageValueSchema(annotations: Record<string, unknown> = {}) {
  return {
    ...ImageValueSchemaDefault,
    ...annotations,
  } as const satisfies PropertySchema;
}
