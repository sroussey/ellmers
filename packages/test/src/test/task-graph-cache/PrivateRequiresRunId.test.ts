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
  TaskConfigurationError,
  TaskGraph,
  type CachePolicy,
} from "@workglow/task-graph";
import { RunPrivateInMemoryTaskOutputRepository } from "@workglow/task-graph/test";
import { Container, ResourceScope, ServiceRegistry, getLogger, setLogger } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

class PrivatePolicyTask extends Task<{ q: string }, { r: string }> {
  public static override type = "PrivateRunIdTask";
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
    return { r: `done:${input.q}` };
  }
}

class DeterministicTask extends Task<{ q: string }, { r: string }> {
  public static override type = "DeterministicRunIdTask";

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
    return { r: `det:${input.q}` };
  }
}

async function freshPrivateRepo(): Promise<RunPrivateInMemoryTaskOutputRepository> {
  const r = new RunPrivateInMemoryTaskOutputRepository();
  await (r as any).setupDatabase?.();
  return r;
}

function freshServices(privateRepo: RunPrivateInMemoryTaskOutputRepository): ServiceRegistry {
  const services = new ServiceRegistry(new Container());
  services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ private: privateRepo }));
  return services;
}

describe("private cache policy requires a runId", () => {
  let originalLogger: ReturnType<typeof getLogger>;
  let warnings: string[];

  beforeEach(() => {
    originalLogger = getLogger();
    warnings = [];
    setLogger({
      debug: () => {},
      info: () => {},
      warn: (msg: unknown) => warnings.push(String(msg)),
      error: () => {},
    } as any);
  });

  afterEach(() => {
    setLogger(originalLogger);
  });

  it("TaskRunner standalone: private-policy task with no runId logs warn-once and does not write to shared private repo", async () => {
    const backing = await freshPrivateRepo();
    const services = freshServices(backing);

    // Two distinct tasks of the same type, run with no runId — only the first
    // call should emit the warning (warn-once-per-task-type).
    const t1 = new PrivatePolicyTask({ defaults: { q: "hello" } } as any);
    const t2 = new PrivatePolicyTask({ defaults: { q: "world" } } as any);

    await t1.run({}, { registry: services });
    await t2.run({}, { registry: services });

    // The private repo must be untouched — without a runId the task should
    // skip caching entirely rather than colliding in the shared namespace.
    expect(await backing.size()).toBe(0);

    const matches = warnings.filter(
      (w) => w.includes("private cache policy") && w.includes(PrivatePolicyTask.type)
    );
    expect(matches.length).toBe(1);
  });

  it("TaskGraphRunner: graph with private-policy task and no runId throws TaskConfigurationError", async () => {
    const backing = await freshPrivateRepo();
    const services = freshServices(backing);

    const g = new TaskGraph();
    g.addTask(new PrivatePolicyTask({ defaults: { q: "hello" } } as any));

    await expect(
      g.run({}, { registry: services, resourceScope: new ResourceScope() })
    ).rejects.toBeInstanceOf(TaskConfigurationError);
  });

  it("TaskGraphRunner: graph with no private-policy task and no runId runs normally", async () => {
    const backing = await freshPrivateRepo();
    const services = freshServices(backing);

    const g = new TaskGraph();
    g.addTask(new DeterministicTask({ defaults: { q: "hello" } } as any));

    // Should not throw despite missing runId, because no task routes to private.
    await expect(
      g.run({}, { registry: services, resourceScope: new ResourceScope() })
    ).resolves.toBeDefined();
  });

  it("TaskRunner standalone: pre-namespaced RunPrivateCacheRepo bypass — no warning, entry is written", async () => {
    const rawBacking = await freshPrivateRepo();
    const runId = "bypass-test-run-001";
    const preNamespaced = new RunPrivateCacheRepo({ backing: rawBacking, runId });

    const services = new ServiceRegistry(new Container());
    services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ private: preNamespaced }));

    // Run with no runId in config — bypass should engage because private slot
    // IS already a RunPrivateCacheRepo, so no downgrade + no warning.
    const task = new PrivatePolicyTask({
      id: "private-task-node-1",
      defaults: { q: "bypass-test" },
    } as any);
    await task.run({}, { registry: services });

    // No warning should have been emitted.
    const matchingWarnings = warnings.filter(
      (w) => w.includes("private cache policy") || w.includes("runId")
    );
    expect(matchingWarnings.length).toBe(0);

    // Private cache keys by task instance id under the wrapper's runId (a
    // first-class column, not a taskType prefix).
    const stored = await rawBacking.getOutputForRun(runId, String(task.id), {
      q: "bypass-test",
      __cv: "1",
    });
    expect(stored).toEqual({ r: "done:bypass-test" });
  });
});
