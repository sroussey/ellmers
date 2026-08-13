/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ImageGenerateTask } from "@workglow/ai";
import { compileSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

function validate(schema: unknown, value: unknown) {
  const compiled = compileSchema(schema as any);
  return compiled.validate(value);
}

describe("ImageGenerateTask schemas", () => {
  it("declares static type, category, cacheable", () => {
    expect(ImageGenerateTask.type).toBe("ImageGenerateTask");
    expect(ImageGenerateTask.category).toBe("AI Vision");
    expect(ImageGenerateTask.cacheable).toBe(true);
  });

  it("accepts a minimal valid input", () => {
    const result = validate(ImageGenerateTask.inputSchema(), {
      prompt: "a sunset",
      model: "openai/gpt-image-2",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects input missing prompt", () => {
    const result = validate(ImageGenerateTask.inputSchema(), {
      model: "openai/gpt-image-2",
    });
    expect(result.valid).toBe(false);
  });

  it("rejects an invalid aspectRatio", () => {
    const result = validate(ImageGenerateTask.inputSchema(), {
      prompt: "x",
      model: "m",
      aspectRatio: "21:9",
    });
    expect(result.valid).toBe(false);
  });

  it("declares output port image with x-stream: replace", () => {
    const schema = ImageGenerateTask.outputSchema() as any;
    expect(schema.properties.image["x-stream"]).toBe("replace");
    expect(schema.properties.image.format).toBe("image");
  });
});
