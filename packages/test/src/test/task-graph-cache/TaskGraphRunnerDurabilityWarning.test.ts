/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  Task,
  TaskGraph,
  CACHE_REGISTRY,
  DefaultCacheRegistry,
  type CachePolicy,
} from "@workglow/task-graph";
import { Container, ResourceScope, ServiceRegistry, getLogger, setLogger } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { InMemoryTaskOutputRepository } from "../../binding/InMemoryTaskOutputRepository";

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
    const backing = new InMemoryTaskOutputRepository();
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
    const backing = new InMemoryTaskOutputRepository();
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

    const backing = new InMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();

    const services = new ServiceRegistry(new Container());
    services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ private: backing }));

    const g = new TaskGraph();
    g.addTask(new DetTask({ defaults: { q: "hello" } } as any));

    await g.run({}, { runId: "warn-3", registry: services, resourceScope: new ResourceScope() });

    expect(messages.some((m) => m.includes("non-durable"))).toBe(false);
  });
});
