/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Input-side CacheRef hydration is gated by the PORT's schema, not the
 * value's shape: only delta-stream ports (`append` / `object` / `binary`)
 * and blob/binary-format ports may resolve a ref against the cache backing.
 * A ref-shaped value arriving at any other port is left untouched — it fails
 * ordinary input validation — and the cache is never read for it, so
 * arbitrary input JSON cannot pull cache entries into ports that never
 * carry refs.
 */

import type { CacheRef } from "@workglow/task-graph";
import { CACHE_REGISTRY, DefaultCacheRegistry, makeCacheRef, Task } from "@workglow/task-graph";
import { StreamingMemoryRepo } from "@workglow/task-graph/test";
import { Container, ServiceRegistry } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeEach, describe, expect, it } from "vitest";

class CountingRepo extends StreamingMemoryRepo {
  public byRefReads = 0;
  override async getOutputByRef(ref: CacheRef): Promise<Blob | undefined> {
    this.byRefReads++;
    return super.getOutputByRef(ref);
  }
  override getOutputStreamByRef(ref: CacheRef): AsyncIterable<Uint8Array> | undefined {
    this.byRefReads++;
    return super.getOutputStreamByRef(ref);
  }
}

type Out = { echoed: string };

class PlainStringPortTask extends Task<{ note: string }, Out> {
  public static override type = "InputRefGating_PlainString";
  public static override category = "Test";
  public static override cacheable = false;

  public received: unknown;

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { note: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { echoed: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  override async execute(input: { note: string }): Promise<Out> {
    this.received = input.note;
    return { echoed: String(input.note) };
  }
}

class BlobPortTask extends Task<{ bytes: unknown }, Out> {
  public static override type = "InputRefGating_BlobPort";
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
      properties: { echoed: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  override async execute(input: { bytes: unknown }): Promise<Out> {
    this.received = input.bytes;
    return { echoed: "ok" };
  }
}

async function* gen(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c;
}

let repo: CountingRepo;
let services: ServiceRegistry;

beforeEach(() => {
  repo = new CountingRepo({});
  services = new ServiceRegistry(new Container());
  services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ deterministic: repo }));
});

describe("CacheRef hydration is restricted to ref-admitting ports", () => {
  it("leaves a ref at a plain string port untouched and never reads the cache", async () => {
    const ref = makeCacheRef({ $ref: "inmem://whatever", size: 3 });
    const task = new PlainStringPortTask();

    await expect(task.run({ note: ref } as any, { registry: services })).rejects.toThrow(
      /does not match schema/
    );
    expect(repo.byRefReads).toBe(0);
    expect(task.received).toBeUndefined(); // execute never ran
  });

  it("still hydrates a ref at a blob-format port (eligible path unchanged)", async () => {
    const ref = await repo.saveOutputStream("Up", { n: 1 }, gen(new Uint8Array([1, 2, 3])), {});
    const task = new BlobPortTask();
    await task.run({ bytes: ref }, { registry: services });

    expect(task.received).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await (task.received as Blob).arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(repo.byRefReads).toBeGreaterThan(0);
  });
});
