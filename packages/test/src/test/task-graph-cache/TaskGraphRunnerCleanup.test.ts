/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CACHE_REGISTRY,
  Dataflow,
  DefaultCacheRegistry,
  Task,
  TaskGraph,
  type CachePolicy,
} from "@workglow/task-graph";
import { RunPrivateInMemoryTaskOutputRepository } from "@workglow/task-graph/test";
import { Container, ResourceScope, ServiceRegistry } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

class PrivTask extends Task<{ q: string }, { r: string }> {
  public static override type = "PrivTask_Cleanup";
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
    return { r: input.q };
  }
}

class FailingTask extends Task<{ q: string }, { r: string }> {
  public static override type = "FailingTask_Cleanup";
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

  public override async execute(): Promise<{ r: string }> {
    throw new Error("boom");
  }
}

function freshServices(privateRepo: RunPrivateInMemoryTaskOutputRepository): ServiceRegistry {
  const services = new ServiceRegistry(new Container());
  services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ private: privateRepo }));
  return services;
}

describe("TaskGraphRunner cleanup on success", () => {
  it("private cache entries for the runId are cleared after a successful run", async () => {
    const backing = new RunPrivateInMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();
    const services = freshServices(backing);

    const graph = new TaskGraph();
    graph.addTask(new PrivTask({ defaults: { q: "hello" } } as any));

    await graph.run(
      {},
      {
        runId: "rid-1",
        registry: services,
        resourceScope: new ResourceScope(),
      }
    );

    expect(await backing.size()).toBe(0);
  });

  it("entries survive a failed run (left for restart/TTL)", async () => {
    const backing = new RunPrivateInMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();
    const services = freshServices(backing);

    // Wire PrivTask → FailingTask so the scheduler guarantees PrivTask completes
    // (and writes to the private cache) before FailingTask runs and fails.
    const graph = new TaskGraph();
    const a = new PrivTask({ defaults: { q: "hello" } } as any);
    const b = new FailingTask({ defaults: { q: "ignored" } } as any);
    graph.addTask(a);
    graph.addTask(b);
    // PrivTask outputs { r } → FailingTask expects { q }. Wire r→q so PrivTask
    // is a declared dependency of FailingTask.
    graph.addDataflow(new Dataflow(a.id, "r", b.id, "q"));

    try {
      await graph.run(
        {},
        {
          runId: "rid-fail",
          registry: services,
          resourceScope: new ResourceScope(),
        }
      );
    } catch {
      // Swallow the error — we only care about cache state, not the thrown value.
    }
    // Some implementations swallow task errors and surface them via a final status;
    // either way, the cleanup contract is: do NOT clear on non-success.
    await new Promise((r) => setTimeout(r, 50));
    expect(await backing.size()).toBeGreaterThan(0);
  });
});
