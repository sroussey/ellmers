/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression test for `fetchAssetBytesNode`'s cache-read catch block.
 *
 * Prior behavior: the outer `try { … fs.readFile … }` caught *every* error
 * and fell through to the network refetch path. That silently masked
 * non-ENOENT filesystem failures (EACCES, EIO, EISDIR, …) as if the cache
 * were simply empty, which both hid real bugs and caused unnecessary network
 * traffic when, e.g., a permission misconfiguration was the underlying cause.
 *
 * New behavior:
 *   - ENOENT  → fall through to network (cache miss, expected).
 *   - any other fs error → rewrap and rethrow with `cause` carrying the
 *     original `code` so the caller can see what actually failed.
 *
 * This test exercises `fetchAssetBytes` via the public entry point. The
 * non-ENOENT case is provoked by making the cache "file" path actually be a
 * directory, which causes `fs.readFile` to fail with `EISDIR` — a clean,
 * cross-platform way to drive the branch without touching production code.
 */

import type { CactusModelConfig } from "@workglow/cactus/ai";
import { fetchAssetBytes } from "@workglow/cactus/ai-runtime";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;

function makeModelConfig(models_dir: string): CactusModelConfig {
  return {
    model_id: "test-row",
    title: "",
    description: "",
    provider: "LOCAL_CACTUS",
    provider_config: { model_id: "needle-26m", models_dir },
    capabilities: ["tool-use"],
    metadata: {},
  } as unknown as CactusModelConfig;
}

describe("fetchAssetBytesNode — cache-read error handling", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cactus-runtime-node-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("ENOENT (no cached file) falls through to network", async () => {
    // No file in `dir/needle-26m/vocab.txt` — fs.readFile rejects with ENOENT.
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const fetchSpy = vi.fn(async () => {
      return new Response(payload, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const bytes = await fetchAssetBytes(makeModelConfig(dir), "vocab.txt");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("EISDIR (non-ENOENT cache error) rejects with wrapped cause; no network fallthrough", async () => {
    // Make the "filename" path actually be a directory so fs.readFile fails
    // with EISDIR — exercises the non-ENOENT branch of the new catch block.
    const modelDir = join(dir, "needle-26m");
    mkdirSync(modelDir, { recursive: true });
    mkdirSync(join(modelDir, "vocab.txt"));

    const fetchSpy = vi.fn(async () => {
      return new Response(new Uint8Array([9, 9, 9]), { status: 200 });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    let caught: unknown;
    try {
      await fetchAssetBytes(makeModelConfig(dir), "vocab.txt");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/Cactus cache read failed/);
    expect((caught as Error).message).toContain("vocab.txt");
    const cause = (caught as Error & { cause?: NodeJS.ErrnoException }).cause;
    expect(cause).toBeDefined();
    expect(cause?.code).toBe("EISDIR");
    // Critical: network must NOT have been called — we wanted the error to
    // surface, not mask it with a refetch.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
