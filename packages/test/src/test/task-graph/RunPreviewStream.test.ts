/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  Dataflow,
  Task,
  Workflow,
  type StreamEvent,
} from "@workglow/task-graph";

class SyntheticStreamSource extends Task<{ trigger: number }, { value: number }> {
  public static override type = "SyntheticStreamSource";
  public static override outputSchema() {
    return {
      type: "object",
      properties: { value: { type: "number", "x-stream": "replace" } },
      required: ["value"],
      additionalProperties: false,
    } as any;
  }
  public static override inputSchema() {
    return {
      type: "object",
      properties: { trigger: { type: "number" } },
      additionalProperties: false,
    } as any;
  }
  async *executeStream(): AsyncIterable<StreamEvent<{ value: number }>> {
    for (let i = 1; i <= 3; i++) {
      yield { type: "snapshot", data: { value: i } };
      await new Promise((r) => setTimeout(r, 5));
    }
    yield { type: "finish", data: {} as { value: number } };
  }
}

class DoubleTask extends Task<{ value: number }, { doubled: number }> {
  public static override type = "DoubleTask";
  public static override outputSchema() {
    return {
      type: "object",
      properties: { doubled: { type: "number" } },
      required: ["doubled"],
      additionalProperties: false,
    } as any;
  }
  public static override inputSchema() {
    return {
      type: "object",
      properties: { value: { type: "number" } },
      required: ["value"],
      additionalProperties: false,
    } as any;
  }
  override async execute(input: { value: number }) {
    return { doubled: (input.value ?? 0) * 2 };
  }
  override async executePreview(input: { value: number }) {
    return { doubled: (input.value ?? 0) * 2 };
  }
}

describe("TaskRunner.runPreviewStream", () => {
  it("yields once immediately even when no upstream is streaming", async () => {
    const wf = new Workflow();
    const src = new SyntheticStreamSource();
    const dst = new DoubleTask();
    wf.graph.addTasks([src, dst]);
    wf.graph.addDataflow(new Dataflow(src.id, "value", dst.id, "value"));

    const yields: { doubled: number }[] = [];
    const iter = dst.runner.runPreviewStream();
    for await (const out of iter) {
      yields.push(out);
      break;
    }
    expect(yields.length).toBe(1);
  });

  it("yields per upstream snapshot during a streaming run", async () => {
    const wf = new Workflow();
    const src = new SyntheticStreamSource();
    const dst = new DoubleTask();
    wf.graph.addTasks([src, dst]);
    wf.graph.addDataflow(new Dataflow(src.id, "value", dst.id, "value"));

    const yields: { doubled: number }[] = [];
    const collector = (async () => {
      for await (const out of dst.runner.runPreviewStream()) {
        yields.push(out);
      }
    })();

    await wf.run();
    await collector;

    expect(yields.length).toBeGreaterThanOrEqual(2);
    const distinct = new Set(yields.map((y) => y.doubled));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("terminates when the consumer breaks out", async () => {
    const wf = new Workflow();
    const src = new SyntheticStreamSource();
    const dst = new DoubleTask();
    wf.graph.addTasks([src, dst]);
    wf.graph.addDataflow(new Dataflow(src.id, "value", dst.id, "value"));

    let yields = 0;
    for await (const _ of dst.runner.runPreviewStream()) {
      yields++;
      break;
    }
    expect(yields).toBe(1);
  });

  it("swallows errors from runPreview — iterator never throws to consumer", async () => {
    const wf = new Workflow();
    const src = new SyntheticStreamSource();
    const dst = new DoubleTask();
    wf.graph.addTasks([src, dst]);
    wf.graph.addDataflow(new Dataflow(src.id, "value", dst.id, "value"));

    // Patch executePreview to throw. runPreview catches errors internally and
    // returns task.runOutputData. The iterator must never throw to the consumer.
    (dst as any).executePreview = async () => {
      throw new Error("boom");
    };

    let threw = false;
    try {
      // Consume first item then break — verifies iterator doesn't throw to consumer.
      for await (const _ of dst.runner.runPreviewStream()) {
        break;
      }
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
