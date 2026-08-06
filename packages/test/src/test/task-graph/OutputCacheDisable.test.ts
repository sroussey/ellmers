/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { TaskInput, TaskOutput } from "@workglow/task-graph";
import { Task, TaskGraph, TaskOutputRepository } from "@workglow/task-graph";
import { describe, expect, test } from "vitest";

class MemoryRepo extends TaskOutputRepository {
  private readonly map = new Map<string, unknown>();
  constructor() {
    super({ outputCompression: false });
  }
  async saveOutput(_t: string, inputs: TaskInput, output: TaskOutput): Promise<void> {
    this.map.set(JSON.stringify(inputs), output);
  }
  async getOutput(_t: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    return this.map.get(JSON.stringify(inputs)) as TaskOutput | undefined;
  }
  async clear(): Promise<void> {
    this.map.clear();
  }
  async size(): Promise<number> {
    return this.map.size;
  }
  async clearOlderThan(_ms: number): Promise<void> {}
  isDurable(): boolean {
    return false;
  }
}

describe("TaskGraph.run outputCache forwarding", () => {
  let runs = 0;
  class CountingTask extends Task<
    Record<string, unknown>,
    { r: number } & Record<string, unknown>
  > {
    static override readonly type = "CountingTask";
    static override outputSchema() {
      return {
        type: "object",
        properties: { r: { type: "number" } },
      } as never;
    }
    override async execute() {
      runs++;
      return { r: runs } as never;
    }
  }

  test("graph-level cache serves the second run when not disabled", async () => {
    runs = 0;
    const graph = new TaskGraph({ outputCache: new MemoryRepo() });
    graph.addTask(new CountingTask({ id: "t" }));
    await graph.run({});
    await graph.run({});
    expect(runs).toBe(1);
  });

  test("outputCache: false disables the graph-level cache for that run", async () => {
    runs = 0;
    const graph = new TaskGraph({ outputCache: new MemoryRepo() });
    graph.addTask(new CountingTask({ id: "t" }));
    await graph.run({}, { outputCache: false });
    await graph.run({}, { outputCache: false });
    expect(runs).toBe(2);
  });
});
