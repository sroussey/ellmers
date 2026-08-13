/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CACHE_REGISTRY,
  DefaultCacheRegistry,
  makeCacheRef,
  RunPrivateCacheRepo,
  Task,
} from "@workglow/task-graph";
import {
  RunPrivateInMemoryTaskOutputRepository,
  StreamingMemoryRepo,
} from "@workglow/task-graph/test";
import { Container, ServiceRegistry } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeEach, describe, expect, it } from "vitest";

async function* gen(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c;
}

type BlobInput = { bytes: unknown };
type Out = { text: string };

class BlobInputTask extends Task<BlobInput, Out> {
  public static override type = "InputHydration_BlobInput";
  public static override category = "Test";
  public static override cacheable = false;

  public received: unknown;

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { bytes: { format: "blob", title: "Bytes" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: BlobInput): Promise<Out> {
    this.received = input.bytes;
    return { text: "ok" };
  }
}

class BinaryInputTask extends BlobInputTask {
  public static override type = "InputHydration_BinaryInput";

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { bytes: { format: "binary", title: "Bytes" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
}

let repo: StreamingMemoryRepo;
let services: ServiceRegistry;

beforeEach(() => {
  repo = new StreamingMemoryRepo({});
  services = new ServiceRegistry(new Container());
  services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ deterministic: repo }));
});

describe("TaskRunner input-side CacheRef hydration", () => {
  it("hydrates a branded ref to a Blob for a format:'blob' input port", async () => {
    const ref = await repo.saveOutputStream("Up", { n: 1 }, gen(new Uint8Array([1, 2, 3])), {});
    const task = new BlobInputTask();
    await task.run({ bytes: ref }, { registry: services });

    expect(task.received).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await (task.received as Blob).arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it("hydrates a branded ref to an ArrayBuffer for a format:'binary' input port", async () => {
    const ref = await repo.saveOutputStream("Up", { n: 2 }, gen(new Uint8Array([4, 5])), {});
    const task = new BinaryInputTask();
    await task.run({ bytes: ref }, { registry: services });

    expect(task.received).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(task.received as ArrayBuffer))).toEqual([4, 5]);
  });

  it("rejects with an error naming the port for a dangling ref", async () => {
    const ref = makeCacheRef({ $ref: "inmem://missing" });
    const task = new BlobInputTask();
    await expect(task.run({ bytes: ref }, { registry: services })).rejects.toThrow(/"bytes"/);
  });

  it("passes ref-free inputs through untouched", async () => {
    const blob = new Blob([new Uint8Array([9])]);
    const task = new BlobInputTask();
    await task.run({ bytes: blob }, { registry: services });
    expect(task.received).toBe(blob);
  });

  it("leaves refs in place when no cache backing offers readers", async () => {
    const bare = new ServiceRegistry(new Container());
    const ref = makeCacheRef({ $ref: "inmem://whatever" });
    const task = new BlobInputTask();
    await task.run({ bytes: ref }, { registry: bare });
    expect(task.received).toBe(ref);
  });
});

describe("TaskRunner rejects a CacheRegistry whose private and deterministic tiers share a backing", () => {
  it("throws when both slots resolve to the same backing instance", async () => {
    const shared = new RunPrivateInMemoryTaskOutputRepository();
    const badServices = new ServiceRegistry(new Container());
    badServices.registerInstance(
      CACHE_REGISTRY,
      new DefaultCacheRegistry({
        deterministic: shared,
        private: new RunPrivateCacheRepo({ backing: shared, runId: "r" }),
      })
    );
    const task = new BlobInputTask();
    await expect(
      task.run({ bytes: new Blob([new Uint8Array([1])]) }, { registry: badServices })
    ).rejects.toThrow(/same backing/);
  });

  it("accepts distinct backing instances for the two slots", async () => {
    const detBacking = new StreamingMemoryRepo({});
    const privBacking = new RunPrivateInMemoryTaskOutputRepository();
    const okServices = new ServiceRegistry(new Container());
    okServices.registerInstance(
      CACHE_REGISTRY,
      new DefaultCacheRegistry({
        deterministic: detBacking,
        private: new RunPrivateCacheRepo({ backing: privBacking, runId: "r" }),
      })
    );
    const task = new BlobInputTask();
    await expect(
      task.run({ bytes: new Blob([new Uint8Array([2])]) }, { registry: okServices })
    ).resolves.toBeDefined();
  });

  it("accepts a private-only registry (deterministic slot unset)", async () => {
    const privBacking = new RunPrivateInMemoryTaskOutputRepository();
    const okServices = new ServiceRegistry(new Container());
    okServices.registerInstance(
      CACHE_REGISTRY,
      new DefaultCacheRegistry({
        private: new RunPrivateCacheRepo({ backing: privBacking, runId: "r" }),
      })
    );
    const task = new BlobInputTask();
    await expect(
      task.run({ bytes: new Blob([new Uint8Array([3])]) }, { registry: okServices })
    ).resolves.toBeDefined();
  });
});
