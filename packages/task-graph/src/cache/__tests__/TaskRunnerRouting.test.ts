/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CACHE_REGISTRY, DefaultCacheRegistry, Task, type CachePolicy } from "@workglow/task-graph";
import { InMemoryTaskOutputRepository } from "@workglow/task-graph/test";
import { Container, ServiceRegistry } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

class CountingTask extends Task<{ q: string }, { r: string }> {
  public static override type = "CountingTask";
  public static count = 0;

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
    CountingTask.count++;
    return { r: `out:${input.q}` };
  }
}

/**
 * Create an isolated ServiceRegistry backed by a fresh Container so that
 * registrations from one test do not bleed into the next (ServiceRegistry's
 * default constructor uses the global Container).
 */
function freshRegistry(): ServiceRegistry {
  return new ServiceRegistry(new Container());
}

async function freshRepo() {
  const r = new InMemoryTaskOutputRepository();
  await (r as any).setupDatabase?.();
  return r;
}

describe("TaskRunner cache routing via CacheRegistry", () => {
  it("second run with same inputs hits deterministic cache", async () => {
    CountingTask.count = 0;
    const services = freshRegistry();
    const det = await freshRepo();
    services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ deterministic: det }));

    const task = new CountingTask();
    // Pass the ServiceRegistry via IRunConfig.registry so handleStart picks up CACHE_REGISTRY.
    await task.run({ q: "x" }, { registry: services });
    await task.run({ q: "x" }, { registry: services });
    expect(CountingTask.count).toBe(1);
  });

  it("no CacheRegistry registered → runs uncached, no error", async () => {
    CountingTask.count = 0;
    const services = freshRegistry();
    // No CACHE_REGISTRY registered — task should still run fine, executing twice.
    const task = new CountingTask();
    await task.run({ q: "x" }, { registry: services });
    await task.run({ q: "x" }, { registry: services });
    expect(CountingTask.count).toBe(2);
  });

  it("task with cachePolicy kind:none never writes", async () => {
    class NoCache extends CountingTask {
      public static override type = "NoCacheTask";
      public static override cachePolicy: CachePolicy = { kind: "none" };
      public static override count = 0;
    }
    NoCache.count = 0;

    const services = freshRegistry();
    const det = await freshRepo();
    services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ deterministic: det }));

    const task = new NoCache();
    await task.run({ q: "x" }, { registry: services });
    expect(await det.size()).toBe(0);
  });
});
