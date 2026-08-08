/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `CacheRef` gains an optional `port` + `mode` discriminator so a single cached
 * row can carry more than one ref (binary AND text/object) unambiguously. The
 * fields are optional: legacy portless binary refs must still be recognized and
 * resolve exactly as before (backward compatibility).
 */

import { CACHE_REF_KIND, isCacheRef, makeCacheRef } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

describe("CacheRef port/mode axis", () => {
  it("carries port + mode when provided", () => {
    const ref = makeCacheRef({
      $ref: "fsfolder://blobs/x_text.ndjson",
      port: "text",
      mode: "object",
      size: 1234,
      mime: "application/x-ndjson",
    });
    expect(ref.kind).toBe(CACHE_REF_KIND);
    expect(ref.$ref).toBe("fsfolder://blobs/x_text.ndjson");
    expect(ref.port).toBe("text");
    expect(ref.mode).toBe("object");
    expect(ref.size).toBe(1234);
    expect(isCacheRef(ref)).toBe(true);
  });

  it("omits port/mode for a legacy binary ref (no extra keys)", () => {
    const ref = makeCacheRef({ $ref: "fsfolder://blobs/x.bin", size: 9 });
    expect(isCacheRef(ref)).toBe(true);
    expect("port" in ref).toBe(false);
    expect("mode" in ref).toBe(false);
  });

  it("recognizes a portless raw branded ref (back-compat)", () => {
    const legacy = { kind: CACHE_REF_KIND, $ref: "fsfolder://blobs/old.bin" };
    expect(isCacheRef(legacy)).toBe(true);
    expect((legacy as { port?: string }).port).toBeUndefined();
  });

  it("rejects a shape-only {$ref} without the brand", () => {
    expect(isCacheRef({ $ref: "not-a-cache-ref" })).toBe(false);
  });
});
