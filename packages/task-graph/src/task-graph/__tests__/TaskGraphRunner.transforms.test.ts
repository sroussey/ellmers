/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Dataflow,
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskStatus,
  registerBuiltInTransforms,
  type CachePolicy,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeAll, describe, expect, it } from "vitest";

describe("TaskGraphRunner applies transforms on edges", () => {
  beforeAll(() => {
    registerBuiltInTransforms();
  });

  it("applies pick + unixToIsoDate chain on the dataflow", async () => {
    class SrcTask extends Task<Record<string, never>, { customer: { created_at: number } }> {
      static override readonly type = "SrcTest14";
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

    let capturedInput: unknown = undefined;

    class TgtTask extends Task<{ date: string }, Record<string, never>> {
      static override readonly type = "TgtTest14";
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
      override async execute(input: { date: string }) {
        capturedInput = input;
        return {};
      }
    }

    const graph = new TaskGraph();
    const src = new SrcTask({ id: "src14" } as any);
    const tgt = new TgtTask({ id: "tgt14" } as any);
    graph.addTask(src);
    graph.addTask(tgt);

    const df = new Dataflow("src14", "customer", "tgt14", "date");
    df.setTransforms([
      { id: "pick", params: { path: "created_at" } },
      { id: "unixToIsoDate", params: { unit: "s" } },
    ]);
    graph.addDataflow(df);

    const runner = new TaskGraphRunner(graph);
    await runner.runGraph();

    expect((capturedInput as any)?.date).toBe("2023-11-14T22:13:20.000Z");
    expect(df.status).not.toBe(TaskStatus.FAILED);
  });
});
