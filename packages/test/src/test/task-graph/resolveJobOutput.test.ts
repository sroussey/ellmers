/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CacheRef, CacheRefResolver, JobHandleLike } from "@workglow/task-graph";
import { makeCacheRef, resolveJobOutput } from "@workglow/task-graph";
import { describe, expect, it, vi } from "vitest";

const handleOf = <T>(value: T): JobHandleLike<T> => ({
  waitFor: async () => value,
});

const ref = (key: string, size = 0): CacheRef => makeCacheRef({ $ref: key, size });

describe("resolveJobOutput", () => {
  it("awaits the job and hydrates a top-level ref through a function resolver", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const resolver: CacheRefResolver = async (r) => (r.$ref === "cache://A" ? blob : undefined);
    const handle = handleOf({ bytes: ref("cache://A", 3) as unknown as Blob });
    const out = await resolveJobOutput(handle, resolver);
    expect(out.bytes).toBe(blob);
  });

  it("accepts an object with getOutputByRef (TaskOutputRepository shape)", async () => {
    const blob = new Blob([new Uint8Array([7, 8])]);
    const backing = {
      getOutputByRef: async (r: CacheRef) => (r.$ref === "cache://B" ? blob : undefined),
    };
    const handle = handleOf({ payload: ref("cache://B", 2) as unknown as Blob });
    const out = await resolveJobOutput(handle, backing);
    expect(out.payload).toBe(blob);
  });

  it("returns the output unchanged when the backing has no getOutputByRef", async () => {
    const original = { bytes: ref("cache://x", 1) as unknown as Blob };
    const handle = handleOf(original);
    const out = await resolveJobOutput(handle, {});
    expect(out).toBe(original);
  });

  it("replaces refs with undefined on cache miss (best-effort)", async () => {
    const handle = handleOf({ bytes: ref("cache://missing", 1) as unknown as Blob });
    const out = await resolveJobOutput(handle, async () => undefined);
    expect(out.bytes).toBeUndefined();
  });

  it("walks nested structures", async () => {
    const blob = new Blob([new Uint8Array([42])]);
    const handle = handleOf({
      meta: { lang: "en" },
      payload: { audio: ref("cache://A", 1) as unknown as Blob },
    });
    const out = await resolveJobOutput(handle, async () => blob);
    expect(out.meta).toEqual({ lang: "en" });
    expect(out.payload.audio).toBe(blob);
  });

  it("propagates rejection from the underlying handle.waitFor()", async () => {
    const handle: JobHandleLike<unknown> = {
      waitFor: async () => {
        throw new Error("job failed");
      },
    };
    await expect(resolveJobOutput(handle, async () => undefined)).rejects.toThrow("job failed");
  });

  it("never invokes getOutputByRef for attacker-supplied {$ref} shapes without the brand", async () => {
    // Cross-tenant attack vector: a task output contains a metadata field whose
    // shape collides with the legacy CacheRef discriminator
    // (`{$ref: "cache://OTHER_RUN/secret"}`). With the literal `kind` brand,
    // the resolver MUST NOT pass the unbranded value to `getOutputByRef`, so
    // bytes from another run/tenant can't be read by shape collision alone.
    const getOutputByRef = vi.fn(async (_r: CacheRef) => new Blob([new Uint8Array([1, 2, 3])]));
    const backing = { getOutputByRef };
    const handle = handleOf({ note: { $ref: "cache://OTHER_RUN/secret" } });
    const out = await resolveJobOutput(handle, backing);
    expect(out.note).toEqual({ $ref: "cache://OTHER_RUN/secret" });
    expect(getOutputByRef).not.toHaveBeenCalled();
  });

  it("forwards ResolveOutputOptions to the underlying walker", async () => {
    let inFlight = 0;
    let observedMax = 0;
    const resolver: CacheRefResolver = async () => {
      inFlight++;
      observedMax = Math.max(observedMax, inFlight);
      await new Promise((res) => setTimeout(res, 5));
      inFlight--;
      return new Blob();
    };
    const handle = handleOf(
      Array.from({ length: 6 }, (_, i) => ref(`cache://r${i}`, 1) as unknown as Blob)
    );
    await resolveJobOutput(handle, resolver, { concurrency: 2 });
    expect(observedMax).toBeLessThanOrEqual(2);
  });
});
