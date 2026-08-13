/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CACHE_REGISTRY,
  DefaultCacheRegistry,
  RunPrivateCacheRepo,
  Task,
  TaskGraph,
  type CachePolicy,
} from "@workglow/task-graph";
import { RunPrivateInMemoryTaskOutputRepository } from "@workglow/task-graph/test";
import { Container, ServiceRegistry } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

class FlakyTask extends Task<{ q: string }, { r: string }> {
  public static override type = "FlakyTask";
  public static override cachePolicy: CachePolicy = { kind: "private" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        q: { type: "string" },
      },
      required: ["q"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        r: { type: "string" },
      },
      required: ["r"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public override async execute(input: { q: string }): Promise<{ r: string }> {
    (FlakyTask as any).runs.push({ q: input.q });
    return { r: `done:${input.q}` };
  }
}

// Attach the static `runs` array properly
(FlakyTask as any).runs = [];

function freshServices(privateRepo: RunPrivateInMemoryTaskOutputRepository): ServiceRegistry {
  const services = new ServiceRegistry(new Container());
  services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ private: privateRepo }));
  return services;
}

async function freshRepo(): Promise<RunPrivateInMemoryTaskOutputRepository> {
  const r = new RunPrivateInMemoryTaskOutputRepository();
  await (r as any).setupDatabase?.();
  return r;
}

describe("TaskGraphRunner with run-private cache", () => {
  it("restart with the same runId reuses run-private entries left by a failed run", async () => {
    // Restart-survival scenario: a FAILED (or aborted) run leaves private cache
    // entries in place (private cache clears only on SUCCESS). A subsequent run with the
    // same runId should reuse those entries rather than re-executing the task.
    (FlakyTask as any).runs = [];
    const backing = await freshRepo();
    const runId = "shared-run";
    const taskId = "flaky-node-resume";

    const task = new FlakyTask({ id: taskId, defaults: { q: "hello" } } as any);

    // Simulate the state left by a previous partial/failed run: write FlakyTask's
    // output directly into the private-namespaced backing store, exactly as the
    // RunPrivateCacheRepo would have done during a real (partial) run.
    // The cache key includes `__cv` (cache version = "1" for FlakyTask which
    // inherits Task.version = 1 and declares no override).
    const wrappedForSeeding = new RunPrivateCacheRepo({ backing, runId });
    await wrappedForSeeding.saveOutput(taskId, { q: "hello", __cv: "1" }, { r: "done:hello" });

    const services = freshServices(backing);

    // Now run graph2 with the same runId — it should hit the pre-seeded cache entry
    // and NOT invoke FlakyTask.execute() again.
    const graph2 = new TaskGraph();
    graph2.addTask(task);

    await graph2.run({}, { runId, registry: services });

    // FlakyTask should have been skipped (cache hit) — runs array stays empty.
    expect((FlakyTask as any).runs.length).toBe(0);
  });

  it("two private-policy tasks of the same type with identical inputs do not share cache entries", async () => {
    (FlakyTask as any).runs = [];
    const backing = await freshRepo();
    const services = freshServices(backing);
    const runId = "same-type-run";

    const graph = new TaskGraph();
    graph.addTask(new FlakyTask({ id: "flaky-a", defaults: { q: "hello" } } as any));
    graph.addTask(new FlakyTask({ id: "flaky-b", defaults: { q: "hello" } } as any));

    await graph.run({}, { runId, registry: services });

    expect((FlakyTask as any).runs.length).toBe(2);
  });

  it("two runs with different runIds do not share private entries", async () => {
    (FlakyTask as any).runs = [];
    const backing = await freshRepo();
    const services = freshServices(backing);

    const graph1 = new TaskGraph();
    graph1.addTask(new FlakyTask({ defaults: { q: "hello" } } as any));

    const graph2 = new TaskGraph();
    graph2.addTask(new FlakyTask({ defaults: { q: "hello" } } as any));

    await graph1.run({}, { runId: "run-1", registry: services });
    await graph2.run({}, { runId: "run-2", registry: services });

    expect((FlakyTask as any).runs.length).toBe(2);
  });
});
