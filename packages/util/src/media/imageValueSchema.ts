/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { DataPortSchema } from "../json-schema/DataPortSchema";

/**
 * Schema annotation for `ImageValue` ports. Multi-type form so the
 * validator accepts the wire forms an `ImageValue` port may receive
 * before hydration: `string` (data: URI), `object` (Blob, ImageBitmap, an
 * ImageValue, or a `Buffer`-like). The `format: "image"` annotation drives
 * the input resolver.
 */
export function ImageValueSchema(annotations: Record<string, unknown> = {}): DataPortSchema {
  return {
    type: ["string", "object"],
    properties: {},
    title: "Image",
    description: "Image (hydrated to ImageValue at task entry)",
    ...annotations,
    format: "image",
  } as unknown as DataPortSchema;
}
