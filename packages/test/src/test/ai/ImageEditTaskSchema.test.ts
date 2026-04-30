/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ImageEditTask } from "@workglow/ai";
import { compileSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

function validate(schema: unknown, value: unknown) {
  const compiled = compileSchema(schema as any);
  return compiled.validate(value);
}

describe("ImageEditTask schemas", () => {
  it("declares static type, category", () => {
    expect(ImageEditTask.type).toBe("ImageEditTask");
    expect(ImageEditTask.category).toBe("AI Vision");
    expect(ImageEditTask.cacheable).toBe(true);
  });

  it("input requires prompt, model, image", () => {
    const minimal = validate(ImageEditTask.inputSchema(), {
      prompt: "make it sepia",
      model: "openai/gpt-image-2",
      image: "data:image/png;base64,iVBORw0KGgo=",
    });
    expect(minimal.valid).toBe(true);

    const missingImage = validate(ImageEditTask.inputSchema(), {
      prompt: "x",
      model: "m",
    });
    expect(missingImage.valid).toBe(false);
  });

  it("mask and additionalImages are optional", () => {
    const result = validate(ImageEditTask.inputSchema(), {
      prompt: "x",
      model: "m",
      image: "data:image/png;base64,iVBORw0KGgo=",
      mask: "data:image/png;base64,iVBORw0KGgo=",
      additionalImages: ["data:image/png;base64,iVBORw0KGgo="],
    });
    expect(result.valid).toBe(true);
  });
});
