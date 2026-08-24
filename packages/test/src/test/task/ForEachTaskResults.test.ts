/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ForEachTask, MapTask, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeEach, describe, expect, test } from "vitest";

/**
 * What a discarding iterator does with the outputs it is discarding.
 *
 * The rest of the ForEachTask suite lives in `IteratorTask.test.ts` and covers
 * the shape of the result. This is the other half of the contract, and it is
 * about memory rather than about values: `collectResults` returning nothing is
 * too late, because the runner has already held every iteration's merged output
 * until the batch ended — and with no `batchSize` the batch is the whole
 * worklist.
 */

const seen: number[] = [];

/**
 * Records the item it was handed.
 *
 * A task rather than a `.pipe()` lambda: `pipe` narrows the builder to
 * `IWorkflow`, which does not carry the `endForEach` augmentation that
 * `Workflow` declares, so the chain stops type-checking before it closes.
 */
class RecordItemTask extends Task<{ items: number }, { ok: boolean }> {
  static override type = "RecordItemTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        items: { type: "number" },
      },
      required: ["items"],
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        ok: { type: "boolean" },
      },
      required: ["ok"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { items: number }): Promise<{ ok: boolean }> {
    seen.push(input.items);
    return { ok: true };
  }
}

describe("ForEachTask result retention", () => {
  beforeEach(() => {
    seen.length = 0;
  });

  test("does not retain iteration outputs it is going to discard", () => {
    expect(new ForEachTask({ maxIterations: "unbounded" }).retainsIterationResults()).toBe(false);
    // Opting back into results opts back into retaining them.
    expect(
      new ForEachTask({
        maxIterations: "unbounded",
        discardResults: false,
      }).retainsIterationResults()
    ).toBe(true);
    // A map folds its results, so it must keep them.
    expect(new MapTask({ maxIterations: "unbounded" }).retainsIterationResults()).toBe(true);
  });

  test("still completes every iteration when results are not retained", async () => {
    // The outputs are dropped, not the work: a side-effect loop must still run
    // its body for each item.
    const workflow = new Workflow();
    workflow.forEach({ maxIterations: "unbounded" }).addTask(RecordItemTask).endForEach();

    const result = (await workflow.run({ items: [1, 2, 3, 4, 5] })) as Record<string, unknown>;

    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    // The empty shape a forEach promises — every port present and empty, none
    // of them carrying the five outputs the iterations produced.
    for (const value of Object.values(result)) {
      expect(value).toEqual([]);
    }
  });
});
