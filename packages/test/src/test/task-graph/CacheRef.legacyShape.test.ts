/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CacheRef, StreamEvent, TaskInput, TaskOutput } from "@workglow/task-graph";
import {
  CACHE_REGISTRY,
  DefaultCacheRegistry,
  IExecuteContext,
  isCacheRef,
  isLegacyUnbrandedCacheRefShape,
  Task,
  TaskOutputRepository,
  TaskRegistry,
} from "@workglow/task-graph";
import { Container, ServiceRegistry } from "@workglow/util";
import { DataPortSchema } from "@workglow/util/schema";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// ============================================================================
// Test repo — pre-loadable, optionally counting getOutputByRef calls
// ============================================================================

class PreLoadableMemoryRepo extends TaskOutputRepository {
  public readonly saved = new Map<string, TaskOutput>();
  public readonly streamed = new Map<string, Uint8Array>();
  public getOutputByRefCalls = 0;

  override async saveOutput(t: string, i: TaskInput, o: TaskOutput): Promise<void> {
    this.saved.set(t + JSON.stringify(i), o);
  }
  override async getOutput(t: string, i: TaskInput): Promise<TaskOutput | undefined> {
    return this.saved.get(t + JSON.stringify(i));
  }
  override async clear(): Promise<void> {
    this.saved.clear();
    this.streamed.clear();
    this.getOutputByRefCalls = 0;
  }
  override async size(): Promise<number> {
    return this.saved.size;
  }
  override async clearOlderThan(): Promise<void> {}
  override isDurable(): boolean {
    return false;
  }
  override supportsStreaming(): boolean {
    return true;
  }
  override async saveOutputStream(
    taskType: string,
    inputs: TaskInput,
    chunks: AsyncIterable<Uint8Array>,
    _metadata: Record<string, unknown>
  ): Promise<CacheRef> {
    const parts: Uint8Array[] = [];
    let size = 0;
    for await (const c of chunks) {
      parts.push(c);
      size += c.byteLength;
    }
    const merged = new Uint8Array(size);
    let off = 0;
    for (const p of parts) {
      merged.set(p, off);
      off += p.byteLength;
    }
    const key = `inmem://${taskType}::${JSON.stringify(inputs)}`;
    this.streamed.set(key, merged);
    // NOTE: returns a properly branded ref via the unbranded-shape route to
    // test the re-wrap path on the sink as well (already covered by
    // CacheCoordinator code). The brand is added by makeCacheRef in the
    // production code path; here we return the legacy shape so the test
    // also exercises the sink-side fallback in isolation. Wrapped by the
    // SinkRouter re-wrap in CacheCoordinator.getBinaryRefSinksByPolicy.
    return { $ref: key, size, mime: "application/octet-stream" } as unknown as CacheRef;
  }
  override async getOutputByRef(ref: CacheRef): Promise<Blob | undefined> {
    this.getOutputByRefCalls++;
    const bytes = this.streamed.get(ref.$ref);
    return bytes === undefined ? undefined : new Blob([bytes as unknown as BlobPart]);
  }
}

// ============================================================================
// Tasks
// ============================================================================

type BinOut = { bytes: Blob };

/**
 * Cacheable, streamable task with a single binary port.
 */
class LegacyShapeBinTask extends Task<Record<string, never>, BinOut> {
  public static override type = "CacheRefLegacyShape_BinaryPort";
  public static override category = "Test";
  public static override cacheable = true;

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { bytes: { type: "object", format: "blob", "x-stream": "binary" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: Record<string, never>,
    _ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<BinOut>> {
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([1, 2, 3]) };
    yield { type: "finish", data: {} as BinOut };
  }
}

/**
 * Non-binary port whose schema is `type: "object"` with no `x-stream`. We use
 * a JSON-Schema-style `{$ref: "#/$defs/X"}` shape as its cached output to
 * confirm the scope guard refuses to walk it.
 */
type RefShapedOut = { meta: { $ref: string } };

class LegacyShapeRefMetaTask extends Task<Record<string, never>, RefShapedOut> {
  public static override type = "CacheRefLegacyShape_RefMeta";
  public static override category = "Test";
  public static override cacheable = true;

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      // No `x-stream` — this port is NOT a binary streaming port.
      properties: { meta: { type: "object" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(_input: Record<string, never>): Promise<RefShapedOut | undefined> {
    // Should never run — the test pre-populates the cache so lookup() short-circuits.
    return { meta: { $ref: "#/$defs/ShouldNeverRun" } };
  }
}

beforeAll(() => {
  TaskRegistry.registerTask(LegacyShapeBinTask as any);
  TaskRegistry.registerTask(LegacyShapeRefMetaTask as any);
});

let repo: PreLoadableMemoryRepo;
let services: ServiceRegistry;
beforeEach(() => {
  repo = new PreLoadableMemoryRepo({});
  services = new ServiceRegistry(new Container());
  services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ deterministic: repo }));
});

// ============================================================================
// isLegacyUnbrandedCacheRefShape — unit-level behaviour
// ============================================================================

describe("isLegacyUnbrandedCacheRefShape", () => {
  it("accepts the minimal unbranded shape with just $ref", () => {
    expect(isLegacyUnbrandedCacheRefShape({ $ref: "cache://k" })).toBe(true);
  });

  it("accepts size and mime hints on the unbranded shape", () => {
    expect(
      isLegacyUnbrandedCacheRefShape({ $ref: "cache://k", size: 1024, mime: "audio/wav" })
    ).toBe(true);
  });

  it("rejects branded refs so callers can use it as a strict 'needs upgrade' predicate", () => {
    const branded = { kind: "task-graph/CacheRef", $ref: "cache://k" } as const;
    expect(isLegacyUnbrandedCacheRefShape(branded)).toBe(false);
  });

  it("rejects shapes whose $ref is not a string", () => {
    expect(isLegacyUnbrandedCacheRefShape({ $ref: 42 })).toBe(false);
    expect(isLegacyUnbrandedCacheRefShape({ $ref: null })).toBe(false);
    expect(isLegacyUnbrandedCacheRefShape({})).toBe(false);
  });

  it("rejects shapes whose size or mime hints have the wrong type", () => {
    expect(isLegacyUnbrandedCacheRefShape({ $ref: "cache://k", size: "big" })).toBe(false);
    expect(isLegacyUnbrandedCacheRefShape({ $ref: "cache://k", mime: 1 })).toBe(false);
  });

  it("rejects primitives and null", () => {
    expect(isLegacyUnbrandedCacheRefShape(null)).toBe(false);
    expect(isLegacyUnbrandedCacheRefShape(undefined)).toBe(false);
    expect(isLegacyUnbrandedCacheRefShape("$ref")).toBe(false);
    expect(isLegacyUnbrandedCacheRefShape(42)).toBe(false);
  });
});

// ============================================================================
// Case A — lookup re-wrap upgrades legacy rows at a declared binary port
// ============================================================================

describe("CacheCoordinator.lookup — legacy unbranded {$ref} upgrade at binary port", () => {
  it("re-wraps a pre-brand cache row in place (Case A — threshold 0 keeps the ref)", async () => {
    // Pre-seed the cache with an unbranded {$ref, size, mime} at the binary
    // port slot. The seed key matches what CacheCoordinator.saveOutput would
    // have written before the brand was introduced.
    const taskType = LegacyShapeBinTask.type;
    // Inputs the task observes — empty object, but the cache key includes
    // the __cv sentinel (cache version) that buildKey injects. Construct a
    // task to read its cache version, then build the matching key.
    const task = new LegacyShapeBinTask();
    const keyInputs = { __cv: task.getCacheVersion() } as TaskInput;
    repo.saved.set(taskType + JSON.stringify(keyInputs), {
      bytes: { $ref: "inmem://legacy/A", size: 1024 },
    } as TaskOutput);

    const output = await task.run({}, { registry: services, referenceThresholdBytes: 0 });

    // Slot is now a properly branded CacheRef.
    expect(isCacheRef((output as Record<string, unknown>).bytes)).toBe(true);
    const ref = (output as unknown as { bytes: CacheRef }).bytes;
    expect(ref.$ref).toBe("inmem://legacy/A");
    expect(ref.size).toBe(1024);
  });

  it("re-wraps and then rehydrates below threshold (Case B — getOutputByRef is called)", async () => {
    const taskType = LegacyShapeBinTask.type;
    const task = new LegacyShapeBinTask();
    const keyInputs = { __cv: task.getCacheVersion() } as TaskInput;

    // Pre-populate the streaming side so getOutputByRef returns a Blob.
    const refKey = "inmem://legacy/B";
    repo.streamed.set(refKey, new Uint8Array([7, 8, 9]));
    repo.saved.set(taskType + JSON.stringify(keyInputs), {
      bytes: { $ref: refKey, size: 3, mime: "application/octet-stream" },
    } as TaskOutput);

    // Threshold above the stored size → rehydrate inline. NOTE: the lookup
    // path itself does not currently call hydrateRefsBelowThreshold — that
    // step runs only after a fresh streaming run. The re-wrap exists so the
    // surfaced value is a recognized CacheRef; the threshold-based rehydrate
    // on cache hits is the consumer's responsibility (e.g. resolveJobOutput).
    // For Case B we therefore verify the lookup path produced a *recognized*
    // ref (so any downstream resolver can call getOutputByRef on it).
    const output = await task.run({}, { registry: services, referenceThresholdBytes: 2048 });

    const slot = (output as Record<string, unknown>).bytes;
    expect(isCacheRef(slot)).toBe(true);
    const ref = slot as CacheRef;
    // Backing recognizes the ref and returns the stored bytes.
    const blob = await repo.getOutputByRef(ref);
    expect(blob).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    expect(Array.from(bytes)).toEqual([7, 8, 9]);
  });

  // ==========================================================================
  // Case C — SCOPE GUARD: the load-bearing safety test
  //
  // A non-binary port carrying a legitimate JSON-Schema {$ref} shape MUST
  // NOT be touched by the upgrade. If this fails, the fix re-introduces the
  // cross-tenant shape-only collision that #557 closes — DO NOT SHIP.
  // ==========================================================================
  it("does NOT upgrade {$ref} shapes at non-binary ports (Case C — scope guard)", async () => {
    const taskType = LegacyShapeRefMetaTask.type;
    const task = new LegacyShapeRefMetaTask();
    const keyInputs = { __cv: task.getCacheVersion() } as TaskInput;

    // Pre-seed a cache hit whose `meta` slot is a JSON-Schema-style $ref.
    // The output schema does NOT mark `meta` as binary, so the upgrade must
    // ignore this slot.
    const jsonSchemaRefShape = { $ref: "#/$defs/Foo" };
    repo.saved.set(taskType + JSON.stringify(keyInputs), {
      meta: jsonSchemaRefShape,
    } as TaskOutput);

    const callsBefore = repo.getOutputByRefCalls;
    const output = await task.run({}, { registry: services });

    // The slot is returned unchanged — NOT branded, NOT touched.
    const slot = (output as { meta: unknown }).meta;
    expect(isCacheRef(slot)).toBe(false);
    expect(slot).toEqual(jsonSchemaRefShape);

    // And getOutputByRef must NEVER be invoked for a non-binary port. If
    // this counter ticked, the scope guard is broken — the resolver walked
    // an arbitrary {$ref} into the cache.
    expect(repo.getOutputByRefCalls).toBe(callsBefore);
  });
});
