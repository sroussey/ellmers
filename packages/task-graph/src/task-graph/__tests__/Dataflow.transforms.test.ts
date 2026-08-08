/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Dataflow,
  Task,
  TaskGraph,
  TaskStatus,
  registerBuiltInTransforms,
  type CachePolicy,
} from "@workglow/task-graph";
import { globalServiceRegistry } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeAll, describe, expect, it } from "vitest";

describe("Dataflow transforms accessors", () => {
  it("defaults to empty chain", () => {
    const d = new Dataflow("a", "out", "b", "in");
    expect(d.getTransforms()).toEqual([]);
  });

  it("setTransforms replaces the chain and invalidates cache", () => {
    const d = new Dataflow("a", "out", "b", "in");
    let invalidateCalls = 0;
    const origInvalidate = (d as any).invalidateCompatibilityCache.bind(d);
    (d as any).invalidateCompatibilityCache = () => {
      invalidateCalls++;
      origInvalidate();
    };
    d.setTransforms([{ id: "pick", params: { path: "x" } }]);
    expect(d.getTransforms()).toHaveLength(1);
    expect(invalidateCalls).toBe(1);
  });

  it("addTransform appends and invalidates cache", () => {
    const d = new Dataflow("a", "out", "b", "in");
    d.addTransform({ id: "pick", params: { path: "x" } });
    d.addTransform({ id: "uppercase" });
    expect(d.getTransforms()).toHaveLength(2);
    expect(d.getTransforms()[0].id).toBe("pick");
    expect(d.getTransforms()[1].id).toBe("uppercase");
  });

  it("removeTransform removes by index and invalidates cache", () => {
    const d = new Dataflow("a", "out", "b", "in");
    d.setTransforms([{ id: "pick" }, { id: "uppercase" }]);
    d.removeTransform(0);
    expect(d.getTransforms()).toEqual([{ id: "uppercase", params: undefined }]);
  });

  it("toJSON includes transforms only when non-empty", () => {
    const d = new Dataflow("a", "out", "b", "in");
    expect(d.toJSON().transforms).toBeUndefined();
    d.addTransform({ id: "pick", params: { path: "x" } });
    expect(d.toJSON().transforms).toEqual([{ id: "pick", params: { path: "x" } }]);
  });
});

describe("Dataflow.applyTransforms", () => {
  beforeAll(() => registerBuiltInTransforms());

  it("folds the chain over the value", async () => {
    const d = new Dataflow("a", "out", "b", "in");
    d.value = { created_at: 1700000000 };
    d.setTransforms([
      { id: "pick", params: { path: "created_at" } },
      { id: "unixToIsoDate", params: { unit: "s" } },
    ]);
    await d.applyTransforms(globalServiceRegistry);
    expect(d.value).toBe("2023-11-14T22:13:20.000Z");
    expect(d.status).not.toBe(TaskStatus.FAILED);
  });

  it("sets FAILED and re-throws on unknown transform id", async () => {
    const d = new Dataflow("a", "out", "b", "in");
    d.value = "x";
    d.setTransforms([{ id: "does-not-exist" }]);
    await expect(d.applyTransforms(globalServiceRegistry)).rejects.toThrow(
      /Unknown transform.*does-not-exist/
    );
    expect(d.status).toBe(TaskStatus.FAILED);
    expect(d.error?.message).toMatch(/Unknown transform.*does-not-exist/);
  });

  it("is a no-op with empty chain", async () => {
    const d = new Dataflow("a", "out", "b", "in");
    d.value = { unchanged: true };
    await d.applyTransforms(globalServiceRegistry);
    expect(d.value).toEqual({ unchanged: true });
  });
});

describe("Dataflow.semanticallyCompatible with transforms", () => {
  beforeAll(() => registerBuiltInTransforms());

  it("composes source schema through chain before comparison", () => {
    // SrcTask: outputs { customer: { created_at: number } }
    class SrcTask extends Task<Record<string, never>, { customer: { created_at: number } }> {
      static override readonly type = "SrcTestTask112";
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
          properties: {
            customer: {
              type: "object",
              properties: { created_at: { type: "number" } },
            },
          },
        } as const satisfies DataPortSchema;
      }
      override async execute() {
        return { customer: { created_at: 1700000000 } };
      }
    }

    // TgtTask: input port "date" expects { type: "string", format: "date-time" }
    class TgtTask extends Task<{ date: string }, Record<string, never>> {
      static override readonly type = "TgtTestTask112";
      static override readonly category = "Test";
      static override readonly title = "Tgt";
      static override readonly description = "";
      static override cachePolicy: CachePolicy = { kind: "none" };
      static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { date: { type: "string", format: "date-time" } },
          required: ["date"],
        } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute() {
        return {};
      }
    }

    const graph = new TaskGraph();
    const src = new SrcTask({ id: "src112" } as any);
    const tgt = new TgtTask({ id: "tgt112" } as any);
    graph.addTask(src);
    graph.addTask(tgt);
    const d = new Dataflow("src112", "customer", "tgt112", "date");
    graph.addDataflow(d);

    // Without transforms: object vs date-time string -> incompatible.
    expect(d.semanticallyCompatible(graph, d)).toBe("incompatible");

    // With pick(created_at) -> number, then unixToIsoDate(s) -> string/date-time -> static.
    d.setTransforms([
      { id: "pick", params: { path: "created_at" } },
      { id: "unixToIsoDate", params: { unit: "s" } },
    ]);
    expect(d.semanticallyCompatible(graph, d)).toBe("static");
  });

  it("returns incompatible when chain contains unknown transform id", () => {
    // SrcTask and TgtTask with matching { x: string } schemas - would normally be "static".
    class SrcXTask extends Task<Record<string, never>, { x: string }> {
      static override readonly type = "SrcXTestTask112";
      static override readonly category = "Test";
      static override readonly title = "SrcX";
      static override readonly description = "";
      static override cachePolicy: CachePolicy = { kind: "none" };
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { x: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      override async execute() {
        return { x: "hello" };
      }
    }

    class TgtXTask extends Task<{ x: string }, Record<string, never>> {
      static override readonly type = "TgtXTestTask112";
      static override readonly category = "Test";
      static override readonly title = "TgtX";
      static override readonly description = "";
      static override cachePolicy: CachePolicy = { kind: "none" };
      static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { x: { type: "string" } },
          required: ["x"],
        } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute() {
        return {};
      }
    }

    const graph = new TaskGraph();
    const src = new SrcXTask({ id: "srcx112" } as any);
    const tgt = new TgtXTask({ id: "tgtx112" } as any);
    graph.addTask(src);
    graph.addTask(tgt);
    const d = new Dataflow("srcx112", "x", "tgtx112", "x");
    graph.addDataflow(d);

    // Without transforms, the string->string connection should be compatible.
    expect(d.semanticallyCompatible(graph, d)).toBe("static");

    // An unknown transform id causes short-circuit to "incompatible".
    d.setTransforms([{ id: "does-not-exist" }]);
    expect(d.semanticallyCompatible(graph, d)).toBe("incompatible");
  });
});
