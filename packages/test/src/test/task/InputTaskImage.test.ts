/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InputTask } from "@workglow/tasks";
import { ImageValueSchema } from "@workglow/util/media";
import type { DataPortSchema, PropertySchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

const PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function imageInputTaskSchema(imageProperty: PropertySchema): DataPortSchema {
  return {
    type: "object",
    properties: { image: imageProperty },
    required: ["image"],
    additionalProperties: false,
  } as const satisfies DataPortSchema;
}

describe("InputTask format:image run", () => {
  it("accepts a data URI when the port uses ImageValueSchema (wire form)", async () => {
    const task = new InputTask({
      inputSchema: imageInputTaskSchema(ImageValueSchema()),
      outputSchema: imageInputTaskSchema(ImageValueSchema()),
    });

    const result = await task.run({ image: PNG_DATA_URI });
    expect(result.image).toBeDefined();
    expect(typeof result.image).toBe("object");
  });
});
