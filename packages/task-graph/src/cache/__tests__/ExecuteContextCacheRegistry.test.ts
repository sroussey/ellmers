/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CacheRegistry, IExecuteContext, StreamEvent } from "@workglow/task-graph";
import { CACHE_REGISTRY, DefaultCacheRegistry, Task } from "@workglow/task-graph";
import { InMemoryTaskOutputRepository } from "@workglow/task-graph/test";
import { Container, ServiceRegistry } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

type Seen = { readonly registry: CacheRegistry | undefined };

let lastSeen: Seen = { registry: undefined };

/** Records what the non-streaming context path carried. */
class PlainProbe extends Task<Record<string, never>, { ok: boolean }> {
  public static override type = "ExecuteContextCacheProbe_Plain";
  public static override category = "Test";

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { ok: { type: "boolean" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public override async execute(
    _input: Record<string, never>,
    context: IExecuteContext
  ): Promise<{ ok: boolean }> {
    lastSeen = { registry: context.cacheRegistry };
    return { ok: true };
  }
}

/** Same probe on the streaming path, which builds its context separately. */
class StreamProbe extends Task<Record<string, never>, { text: string }> {
  public static override type = "ExecuteContextCacheProbe_Stream";
  public static override category = "Test";

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: Record<string, never>,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<{ text: string }>> {
    lastSeen = { registry: context.cacheRegistry };
    yield { type: "text-delta", port: "text", textDelta: "hi" };
    yield { type: "finish", data: {} as { text: string } };
  }
}

function freshRegistry(): ServiceRegistry {
  return new ServiceRegistry(new Container());
}

async function freshRepo(): Promise<InMemoryTaskOutputRepository> {
  const repo = new InMemoryTaskOutputRepository();
  await (repo as unknown as { setupDatabase?: () => Promise<void> }).setupDatabase?.();
  return repo;
}

/**
 * A task cannot re-derive "will my output be stored" from any one source: the
 * runner reaches that answer three ways and only it knows the precedence. Both
 * context paths — `execute()` and `executeStream()` — must publish the SAME
 * resolved value, or a task gets a different answer for the accident of which
 * one it implements.
 */
describe("IExecuteContext.cacheRegistry", () => {
  const cases: ReadonlyArray<{
    readonly label: string;
    readonly make: () => PlainProbe | StreamProbe;
  }> = [
    { label: "execute()", make: () => new PlainProbe() },
    { label: "executeStream()", make: () => new StreamProbe() },
  ];

  for (const { label, make } of cases) {
    describe(label, () => {
      it("carries the repository passed as the run config's outputCache", async () => {
        const repo = await freshRepo();
        lastSeen = { registry: undefined };
        await make().run({}, { outputCache: repo });
        expect(lastSeen.registry?.deterministic).toBe(repo);
      });

      it("carries the repository named by the task's own runConfig", async () => {
        const repo = await freshRepo();
        lastSeen = { registry: undefined };
        const task = make();
        task.runConfig.outputCache = repo;
        await task.run({});
        expect(lastSeen.registry?.deterministic).toBe(repo);
      });

      it("carries a CACHE_REGISTRY binding from the run's ServiceRegistry", async () => {
        const repo = await freshRepo();
        const services = freshRegistry();
        const bound = new DefaultCacheRegistry({ deterministic: repo });
        services.registerInstance(CACHE_REGISTRY, bound);
        lastSeen = { registry: undefined };
        await make().run({}, { registry: services });
        expect(lastSeen.registry).toBe(bound);
      });

      // `outputCache: false` is how a caller turns caching OFF for one run, so
      // reporting the instance's repository here would tell a task its output
      // is about to be stored when nothing will store it.
      it("is undefined when the run has no cache, or disabled one", async () => {
        lastSeen = { registry: undefined };
        await make().run({}, { registry: freshRegistry() });
        expect(lastSeen.registry).toBeUndefined();

        const task = make();
        task.runConfig.outputCache = await freshRepo();
        lastSeen = { registry: undefined };
        await task.run({}, { outputCache: false });
        expect(lastSeen.registry).toBeUndefined();
      });
    });
  }
});
