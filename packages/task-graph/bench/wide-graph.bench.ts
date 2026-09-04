/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wide-graph benchmark: fan-out breadth.
 *
 * A single source task feeds its output into many independent leaf tasks that
 * have no dependencies on one another. This stresses the scheduler's ability to
 * dispatch a large number of ready tasks and materialize edges across a wide
 * frontier rather than a long chain.
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

class WideCounterTask extends Task<CounterInput, CounterOutput> {
  public static override type = "Bench_WideCounterTask";
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

function buildWideGraph(width: number): TaskGraph {
  const graph = new TaskGraph();
  graph.addTask(new WideCounterTask({ id: "source", defaults: { n: 0 } }));
  for (let i = 0; i < width; i++) {
    const leafId = `leaf-${i}`;
    graph.addTask(new WideCounterTask({ id: leafId }));
    graph.addDataflow(new Dataflow("source", "n", leafId, "n"));
  }
  return graph;
}

test("wide-graph fan-out", async ({ bench }) => {
  await bench("50 parallel leaves", async () => {
    const graph = buildWideGraph(50);
    await graph.run();
  }).run();

  await bench("200 parallel leaves", async () => {
    const graph = buildWideGraph(200);
    await graph.run();
  }).run();
});
