/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy } from "@workglow/task-graph";
import { CACHE_REGISTRY, DefaultCacheRegistry, Task, TaskGraph } from "@workglow/task-graph";
import { RunPrivateInMemoryTaskOutputRepository } from "@workglow/task-graph/test";
import { Container, ResourceScope, ServiceRegistry, getLogger, setLogger } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

class PrivTask extends Task<{ q: string }, { r: string }> {
  public static override type = "DurabilityWarnTask";
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

describe("TaskGraphRunner durability warning", () => {
  let originalLogger: ReturnType<typeof getLogger>;
  let messages: string[];

  beforeEach(() => {
    originalLogger = getLogger();
    messages = [];
    setLogger({
      debug: () => {},
      info: () => {},
      warn: (msg: unknown) => messages.push(String(msg)),
      error: () => {},
    } as any);
  });

  afterEach(() => {
    setLogger(originalLogger);
  });

  it("warns when a private-policy task is wired to a non-durable repo", async () => {
    const backing = new RunPrivateInMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();

    const services = new ServiceRegistry(new Container());
    services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ private: backing }));

    const g = new TaskGraph();
    g.addTask(new PrivTask({ defaults: { q: "hello" } } as any));

    await g.run({}, { runId: "warn-1", registry: services, resourceScope: new ResourceScope() });

    expect(messages.some((m) => m.includes("private cache") && m.includes("non-durable"))).toBe(
      true
    );
  });

  it("does NOT warn when private repo is durable", async () => {
    const backing = new RunPrivateInMemoryTaskOutputRepository();
    (backing as any).isDurable = () => true;
    await (backing as any).setupDatabase?.();

    const services = new ServiceRegistry(new Container());
    services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ private: backing }));

    const g = new TaskGraph();
    g.addTask(new PrivTask({ defaults: { q: "hello" } } as any));

    await g.run({}, { runId: "warn-2", registry: services, resourceScope: new ResourceScope() });

    expect(messages.some((m) => m.includes("non-durable"))).toBe(false);
  });

  it("does NOT warn when no task uses private policy", async () => {
    class DetTask extends Task<{ q: string }, { r: string }> {
      public static override type = "DetTaskNoWarn";

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

    const backing = new RunPrivateInMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();

    const services = new ServiceRegistry(new Container());
    services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ private: backing }));

    const g = new TaskGraph();
    g.addTask(new DetTask({ defaults: { q: "hello" } } as any));

    await g.run({}, { runId: "warn-3", registry: services, resourceScope: new ResourceScope() });

    expect(messages.some((m) => m.includes("non-durable"))).toBe(false);
  });

  it("emits durability warning only once per private repo across multiple runGraph calls", async () => {
    const backing = new RunPrivateInMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();

    const services = new ServiceRegistry(new Container());
    services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ private: backing }));

    // Three runs against the same non-durable private repo. The warning must
    // fire on the first run only — subsequent runs hit the WeakSet rate-limit.
    for (let i = 0; i < 3; i++) {
      const g = new TaskGraph();
      g.addTask(new PrivTask({ defaults: { q: `hello-${i}` } } as any));
      await g.run(
        {},
        { runId: `rate-${i}`, registry: services, resourceScope: new ResourceScope() }
      );
    }

    const matches = messages.filter((m) => m.includes("non-durable"));
    expect(matches.length).toBe(1);
  });

  it("emits a fresh warning for a different repo instance", async () => {
    // First repo — should warn once.
    const backingA = new RunPrivateInMemoryTaskOutputRepository();
    await (backingA as any).setupDatabase?.();
    const servicesA = new ServiceRegistry(new Container());
    servicesA.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ private: backingA }));
    const gA = new TaskGraph();
    gA.addTask(new PrivTask({ defaults: { q: "a" } } as any));
    await gA.run({}, { runId: "ra", registry: servicesA, resourceScope: new ResourceScope() });

    // Second, separate repo instance — must warn again (WeakSet keys on repo).
    const backingB = new RunPrivateInMemoryTaskOutputRepository();
    await (backingB as any).setupDatabase?.();
    const servicesB = new ServiceRegistry(new Container());
    servicesB.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ private: backingB }));
    const gB = new TaskGraph();
    gB.addTask(new PrivTask({ defaults: { q: "b" } } as any));
    await gB.run({}, { runId: "rb", registry: servicesB, resourceScope: new ResourceScope() });

    const matches = messages.filter((m) => m.includes("non-durable"));
    expect(matches.length).toBe(2);
  });

  it("restores registry between runs to avoid nested RunPrivateCacheRepo wrappers", async () => {
    const backing = new RunPrivateInMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();
    const services = new ServiceRegistry(new Container());
    services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ private: backing }));

    const g = new TaskGraph();
    g.addTask(new PrivTask({ defaults: { q: "hello" } } as any));

    await g.run({}, { runId: "wrap-a", registry: services, resourceScope: new ResourceScope() });
    await g.run({}, { runId: "wrap-b", resourceScope: new ResourceScope() });

    expect(messages.some((m) => m.includes("RunPrivateCacheRepo.clearRun failed"))).toBe(false);
  });

  it("warns when task declares static cachePolicy:'private' even if getCachePolicy returns 'deterministic' for empty inputs", async () => {
    class TrickyTask extends Task<{ q: string }, { r: string }> {
      public static override type = "TrickyPrivateForEmpty";
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

      // Override that lies about empty inputs — old probe would have missed
      // this. New static-first detector catches it via static cachePolicy.
      public override getCachePolicy(inputs: { q: string }): CachePolicy {
        if (!inputs || !inputs.q) return { kind: "deterministic" };
        return { kind: "private" };
      }

      public override async execute(input: { q: string }): Promise<{ r: string }> {
        return { r: input.q };
      }
    }

    const backing = new RunPrivateInMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();
    const services = new ServiceRegistry(new Container());
    services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ private: backing }));

    const g = new TaskGraph();
    g.addTask(new TrickyTask({ defaults: { q: "hello" } } as any));

    await g.run({}, { runId: "tricky-1", registry: services, resourceScope: new ResourceScope() });

    expect(messages.some((m) => m.includes("non-durable"))).toBe(true);
  });

  it("warns for input-dependent private tasks via override detection", async () => {
    // No static cachePolicy — only the override decides. Detector must still
    // conservatively flag it because the override exists.
    class OverrideOnlyTask extends Task<{ priv: boolean; q: string }, { r: string }> {
      public static override type = "OverrideOnlyPrivate";

      public static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            priv: { type: "boolean" },
            q: { type: "string" },
          },
          required: ["priv", "q"],
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

      public override getCachePolicy(inputs: { priv: boolean; q: string }): CachePolicy {
        return inputs.priv ? { kind: "private" } : { kind: "deterministic" };
      }

      public override async execute(input: { priv: boolean; q: string }): Promise<{ r: string }> {
        return { r: input.q };
      }
    }

    const backing = new RunPrivateInMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();
    const services = new ServiceRegistry(new Container());
    services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ private: backing }));

    const g = new TaskGraph();
    g.addTask(new OverrideOnlyTask({ defaults: { priv: true, q: "hello" } } as any));

    await g.run(
      {},
      { runId: "override-1", registry: services, resourceScope: new ResourceScope() }
    );

    expect(messages.some((m) => m.includes("non-durable"))).toBe(true);
  });
});
