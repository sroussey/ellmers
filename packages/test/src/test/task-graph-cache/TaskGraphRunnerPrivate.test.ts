/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  Task,
  TaskGraph,
  CACHE_REGISTRY,
  DefaultCacheRegistry,
  type CachePolicy,
} from "@workglow/task-graph";
import { Container, ServiceRegistry } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { InMemoryTaskOutputRepository } from "../../binding/InMemoryTaskOutputRepository";

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

function freshServices(privateRepo: InMemoryTaskOutputRepository): ServiceRegistry {
  const services = new ServiceRegistry(new Container());
  services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ private: privateRepo }));
  return services;
}

async function freshRepo(): Promise<InMemoryTaskOutputRepository> {
  const r = new InMemoryTaskOutputRepository();
  await (r as any).setupDatabase?.();
  return r;
}

describe("TaskGraphRunner with run-private cache", () => {
  it("two runs with the same runId reuse run-private entries (restart survival)", async () => {
    (FlakyTask as any).runs = [];
    const backing = await freshRepo();
    const services = freshServices(backing);

    const graph1 = new TaskGraph();
    graph1.addTask(new FlakyTask({ defaults: { q: "hello" } } as any));

    const graph2 = new TaskGraph();
    graph2.addTask(new FlakyTask({ defaults: { q: "hello" } } as any));

    const runId = "shared-run";
    await graph1.run({}, { runId, registry: services });
    await graph2.run({}, { runId, registry: services });

    expect((FlakyTask as any).runs.length).toBe(1);
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
