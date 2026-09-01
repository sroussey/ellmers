/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, StreamEvent } from "@workglow/task-graph";
import {
  Dataflow,
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskRegistry,
  TaskStatus,
  createGraphFromGraphJSON,
  registerBaseTasks,
  registerBuiltInTransforms,
  type CachePolicy,
} from "@workglow/task-graph";
import { InputTask, OutputTask, registerCommonTasks } from "@workglow/tasks";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeAll, describe, expect, it } from "vitest";

describe("Transforms end-to-end", () => {
  beforeAll(() => {
    registerBaseTasks();
    registerCommonTasks({ fileSystemTasks: false });
    registerBuiltInTransforms();
  });

  it("InputTask → [pick, unixToIsoDate] → OutputTask produces ISO string", async () => {
    const input = new InputTask({
      id: "src-e2e",
      defaults: { customer: { created_at: 1700000000 } },
    });
    const output = new OutputTask({ id: "tgt-e2e" });

    const graph = new TaskGraph();
    graph.addTask(input);
    graph.addTask(output);

    // Wire customer object from src → date on tgt, with a transform chain
    const df = new Dataflow("src-e2e", "customer", "tgt-e2e", "date");
    df.setTransforms([
      { id: "pick", params: { path: "created_at" } },
      { id: "unixToIsoDate", params: { unit: "s" } },
    ]);
    graph.addDataflow(df);

    const runner = new TaskGraphRunner(graph);
    await runner.runGraph();

    expect(output.runInputData?.date).toBe("2023-11-14T22:13:20.000Z");
    expect(df.status).not.toBe(TaskStatus.FAILED);
  });

  it("round-trips transforms through dataflow serialization", () => {
    // Test Dataflow.toJSON() directly — no graph needed for serialization.
    const df = new Dataflow("a", "out", "b", "in");
    df.setTransforms([{ id: "pick", params: { path: "x" } }, { id: "uppercase" }]);

    const json = df.toJSON();

    expect(json.transforms?.length).toBe(2);
    expect(json.transforms?.[0]).toEqual({ id: "pick", params: { path: "x" } });
    expect(json.transforms?.[1]?.id).toBe("uppercase");
  });

  it("unknown transform id — data not delivered to target task", async () => {
    // Use typed task classes so the schema compatibility check runs the transform
    // chain and can detect the unknown id.
    class SrcEE extends Task<Record<string, never>, { value: string }> {
      static override readonly type = "SrcEE_unknown";
      static override readonly category = "Test";
      static override readonly title = "Src";
      static override readonly description = "";
      static override cachePolicy: CachePolicy = { kind: "none" };
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { value: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      override async execute() {
        return { value: "hello" };
      }
    }

    let receivedInput: unknown = undefined;
    class TgtEE extends Task<{ result: string }, Record<string, never>> {
      static override readonly type = "TgtEE_unknown";
      static override readonly category = "Test";
      static override readonly title = "Tgt";
      static override readonly description = "";
      static override cachePolicy: CachePolicy = { kind: "none" };
      static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { result: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(input: { result: string }) {
        receivedInput = input;
        return {};
      }
    }

    const src = new SrcEE({ id: "src-ee" } as any);
    const tgt = new TgtEE({ id: "tgt-ee" } as any);

    const graph = new TaskGraph();
    graph.addTask(src);
    graph.addTask(tgt);

    const df = new Dataflow("src-ee", "value", "tgt-ee", "result");
    df.setTransforms([{ id: "does-not-exist" }]);
    graph.addDataflow(df);

    const runner = new TaskGraphRunner(graph);
    try {
      await runner.runGraph();
    } catch {
      // Errors propagating from the graph are acceptable.
    }

    // The dataflow is incompatible (unknown transform → schema check fails),
    // so no data reaches the target task.
    expect((receivedInput as any)?.result).toBeUndefined();
  });

  it("streaming source → non-streaming target applies transforms on edge", async () => {
    class StreamSrc extends Task<Record<string, never>, { text: string }> {
      static override readonly type = "StreamSrcTestTransform";
      static override readonly category = "Test";
      static override readonly title = "StreamSrc";
      static override readonly description = "";
      static override cachePolicy: CachePolicy = { kind: "none" };
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            text: { type: "string", "x-stream": "append" },
          },
        } as const satisfies DataPortSchema;
      }
      async *executeStream(
        _input: Record<string, never>,
        _context: IExecuteContext
      ): AsyncIterable<StreamEvent<{ text: string }>> {
        yield { type: "text-delta", port: "text", textDelta: "hello " };
        yield { type: "text-delta", port: "text", textDelta: "world" };
        yield { type: "finish", data: { text: "hello world" } };
      }
      override async execute() {
        return { text: "hello world" };
      }
    }

    let captured: unknown = undefined;
    class NonStreamTgt extends Task<{ value: string }, Record<string, never>> {
      static override readonly type = "NonStreamTgtTestTransform";
      static override readonly category = "Test";
      static override readonly title = "NonStreamTgt";
      static override readonly description = "";
      static override cachePolicy: CachePolicy = { kind: "none" };
      static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(input: { value: string }) {
        captured = input;
        return {};
      }
    }

    const src = new StreamSrc({ id: "stream-src-t" } as any);
    const tgt = new NonStreamTgt({ id: "non-stream-tgt-t" } as any);
    const graph = new TaskGraph();
    graph.addTask(src);
    graph.addTask(tgt);

    const df = new Dataflow("stream-src-t", "text", "non-stream-tgt-t", "value");
    df.setTransforms([{ id: "uppercase" }]);
    graph.addDataflow(df);

    const runner = new TaskGraphRunner(graph);
    await runner.runGraph();

    expect((captured as any)?.value).toBe("HELLO WORLD");
    expect(df.status).not.toBe(TaskStatus.FAILED);
  });

  it("runtime transform failure fails the graph loudly", async () => {
    class SrcRTF extends Task<Record<string, never>, { text: string }> {
      static override readonly type = "SrcRTFTestTransform";
      static override readonly category = "Test";
      static override readonly title = "SrcRTF";
      static override readonly description = "";
      static override cachePolicy: CachePolicy = { kind: "none" };
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { text: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      override async execute() {
        return { text: "not-a-json" };
      }
    }

    let reached = false;
    class TgtRTF extends Task<{ data: unknown }, Record<string, never>> {
      static override readonly type = "TgtRTFTestTransform";
      static override readonly category = "Test";
      static override readonly title = "TgtRTF";
      static override readonly description = "";
      static override cachePolicy: CachePolicy = { kind: "none" };
      static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { data: {} },
        } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute() {
        reached = true;
        return {};
      }
    }

    const src = new SrcRTF({ id: "src-rtf" } as any);
    const tgt = new TgtRTF({ id: "tgt-rtf" } as any);
    const graph = new TaskGraph();
    graph.addTask(src);
    graph.addTask(tgt);

    const df = new Dataflow("src-rtf", "text", "tgt-rtf", "data");
    df.setTransforms([{ id: "parseJson" }]);
    graph.addDataflow(df);

    const runner = new TaskGraphRunner(graph);
    await expect(runner.runGraph()).rejects.toThrow();
    expect(reached).toBe(false);
    expect(df.status).toBe(TaskStatus.FAILED);
  });

  it("round-trips transforms through createGraphFromGraphJSON", async () => {
    class RTJSrc extends Task<Record<string, never>, { value: string }> {
      static override readonly type = "RTJSrcTestTransform";
      static override readonly category = "Test";
      static override readonly title = "RTJSrc";
      static override readonly description = "";
      static override cachePolicy: CachePolicy = { kind: "none" };
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { value: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      override async execute() {
        return { value: "hello" };
      }
    }

    let captured: unknown = undefined;
    class RTJTgt extends Task<{ value: string }, Record<string, never>> {
      static override readonly type = "RTJTgtTestTransform";
      static override readonly category = "Test";
      static override readonly title = "RTJTgt";
      static override readonly description = "";
      static override cachePolicy: CachePolicy = { kind: "none" };
      static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(input: { value: string }) {
        captured = input;
        return {};
      }
    }

    TaskRegistry.registerTask(RTJSrc);
    TaskRegistry.registerTask(RTJTgt);

    const g1 = new TaskGraph();
    g1.addTask(new RTJSrc({ id: "src-rtj" } as any));
    g1.addTask(new RTJTgt({ id: "tgt-rtj" } as any));
    const df = new Dataflow("src-rtj", "value", "tgt-rtj", "value");
    df.setTransforms([{ id: "uppercase" }]);
    g1.addDataflow(df);

    const json = g1.toJSON();
    const g2 = createGraphFromGraphJSON(json);

    const rebuiltDf = g2.getDataflows()[0];
    expect(rebuiltDf.getTransforms()).toEqual([{ id: "uppercase", params: undefined }]);

    await new TaskGraphRunner(g2).runGraph();
    expect((captured as any)?.value).toBe("HELLO");
  });
});
