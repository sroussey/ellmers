/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  imageValueFromBuffer,
  registerPreviewResizeFn,
  setPreviewBudget,
  type ImageValue,
} from "@workglow/util/media";
import { Task, TaskGraph, TaskRegistry } from "@workglow/task-graph";

class TestImageSource extends Task<Record<string, unknown>, { image: ImageValue }> {
  public static override readonly type = "TestImageSource";
  public static override readonly category = "Test" as const;
  public static override readonly title = "TestImageSource";
  public static override readonly description = "";
  public static override readonly cacheable = false;
  public static override inputSchema() {
    return { type: "object" as const, properties: {} } as any;
  }
  public static override outputSchema() {
    return {
      type: "object" as const,
      properties: { image: { type: "object" as const, format: "image" } },
    } as any;
  }
  override async execute() {
    return { image: imageValueFromBuffer(Buffer.alloc(0), "raw-rgba", 2048, 1024) };
  }
  override async executePreview() {
    return this.execute();
  }
}
TaskRegistry.registerTask(TestImageSource);

describe("TaskGraphRunner.runPreview applies previewSource at output", () => {
  beforeEach(() => {
    setPreviewBudget(512);
    registerPreviewResizeFn(async (v, w, h) =>
      imageValueFromBuffer(Buffer.alloc(0), "raw-rgba", w, h, w / v.width)
    );
  });
  afterEach(() => {
    setPreviewBudget(512);
    registerPreviewResizeFn(undefined);
  });

  test("downscales over-budget image at task output during preview", async () => {
    const graph = new TaskGraph();
    const node = new TestImageSource({ id: "src" });
    graph.addTask(node);
    await graph.runPreview({});
    const out = node.runOutputData?.image as ImageValue;
    expect(out.width).toBe(512);
    expect(out.previewScale).toBeCloseTo(0.25, 5);
  });

  test("does not apply previewSource on full run()", async () => {
    const graph = new TaskGraph();
    const node = new TestImageSource({ id: "src" });
    graph.addTask(node);
    await graph.run({});
    const out = node.runOutputData?.image as ImageValue;
    expect(out.width).toBe(2048);
    expect(out.previewScale).toBe(1.0);
  });
});
