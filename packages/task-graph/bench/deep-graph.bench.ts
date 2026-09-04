/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deep-graph benchmark: dependency-chain depth.
 *
 * A long linear chain where each task consumes the previous task's output.
 * Nothing can run in parallel, so this isolates the per-hop overhead of the
 * scheduler: edge materialization, status propagation, and the topological
 * step from one task to the next.
 */

import type { CachePolicy, IExecuteContext } from "@workglow/task-graph";
import { Dataflow, Task, TaskGraph } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { test } from "vitest";

interface CounterInput {
  readonly n: number;
}

interface CounterOutput {
  readonly n: number;
}

class ChainCounterTask extends Task<CounterInput, CounterOutput> {
  public static override type = "Bench_ChainCounterTask";
  public static override category = "Benchmark";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { n: { type: "number", default: 0 } },
      required: ["n"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { n: { type: "number" } },
      required: ["n"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: CounterInput, _context: IExecuteContext): Promise<CounterOutput> {
    return { n: input.n + 1 };
  }
}

function buildDeepGraph(depth: number): TaskGraph {
  const graph = new TaskGraph();
  graph.addTask(new ChainCounterTask({ id: "node-0", defaults: { n: 0 } }));
  for (let i = 1; i < depth; i++) {
    const id = `node-${i}`;
    graph.addTask(new ChainCounterTask({ id }));
    graph.addDataflow(new Dataflow(`node-${i - 1}`, "n", id, "n"));
  }
  return graph;
}

test("deep-graph chain", async ({ bench }) => {
  await bench("50-deep chain", async () => {
    const graph = buildDeepGraph(50);
    await graph.run();
  }).run();

  await bench("200-deep chain", async () => {
    const graph = buildDeepGraph(200);
    await graph.run();
  }).run();
});
