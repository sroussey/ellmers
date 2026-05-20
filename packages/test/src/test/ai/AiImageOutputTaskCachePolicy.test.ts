/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "@workglow/ai";
import { AiImageOutputTask } from "@workglow/ai";
import { describe, expect, it } from "vitest";

// Minimal concrete subclass — AiImageOutputTask needs inputSchema/outputSchema
// to be fully constructable, same pattern as AiImageOutputTask.test.ts.
class TestImageTask extends AiImageOutputTask<{
  prompt: string;
  model: ModelConfig | string;
  seed?: number | undefined;
}> {
  public static override type = "TestImageTask_CachePolicy";
  public static override category = "Test";
  public static override inputSchema() {
    return {
      type: "object",
      properties: {
        prompt: { type: "string" },
        model: { type: "string", format: "model:TestImageTask_CachePolicy" },
        seed: { type: "number" },
      },
      required: ["prompt", "model"],
      additionalProperties: false,
    } as any;
  }
}

describe("AiImageOutputTask cache policy", () => {
  it("with seed → deterministic", () => {
    const t = new TestImageTask({});
    const policy = t.getCachePolicy({ prompt: "p", model: "m", seed: 42 });
    expect(policy).toEqual({ kind: "deterministic" });
  });

  it("without seed → private (cached per-run only)", () => {
    const t = new TestImageTask({});
    const policy = t.getCachePolicy({ prompt: "p", model: "m" });
    expect(policy).toEqual({ kind: "private" });
  });

  it("with seed=null → private", () => {
    const t = new TestImageTask({});
    // Cast to any to pass null — tests the runtime branch even though the type
    // declares seed as number | undefined.
    const policy = t.getCachePolicy({ prompt: "p", model: "m", seed: null as any });
    expect(policy).toEqual({ kind: "private" });
  });
});
