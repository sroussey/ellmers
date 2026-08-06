/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CacheRef, IRunConfig } from "@workglow/task-graph";
import {
  CACHE_REF_KIND,
  isCacheRef,
  makeCacheRef,
  REFERENCE_THRESHOLD_BYTES_DEFAULT,
  resolveReferenceThreshold,
} from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

describe("isCacheRef", () => {
  it("accepts a minimal branded ref carrying only $ref", () => {
    const ref: CacheRef = makeCacheRef({ $ref: "cache://k1" });
    expect(isCacheRef(ref)).toBe(true);
  });

  it("accepts a branded ref carrying size and mime hints", () => {
    const ref: CacheRef = makeCacheRef({ $ref: "cache://k2", size: 1024, mime: "audio/wav" });
    expect(isCacheRef(ref)).toBe(true);
  });

  it("rejects values without a string $ref", () => {
    expect(isCacheRef({ kind: CACHE_REF_KIND })).toBe(false);
    expect(isCacheRef({ kind: CACHE_REF_KIND, ref: "cache://k" })).toBe(false);
    expect(isCacheRef({ kind: CACHE_REF_KIND, $ref: 42 })).toBe(false);
    expect(isCacheRef({ kind: CACHE_REF_KIND, $ref: null })).toBe(false);
  });

  it("rejects values that lack the kind brand even when $ref is a string", () => {
    expect(isCacheRef({ $ref: "cache://k" })).toBe(false);
    expect(isCacheRef({ $ref: "cache://k", size: 10 })).toBe(false);
  });

  it("rejects values whose kind is not the literal brand", () => {
    expect(isCacheRef({ kind: "other", $ref: "cache://k" })).toBe(false);
    expect(isCacheRef({ kind: 1, $ref: "cache://k" })).toBe(false);
  });

  it("rejects primitives and null", () => {
    expect(isCacheRef(null)).toBe(false);
    expect(isCacheRef(undefined)).toBe(false);
    expect(isCacheRef("cache://k")).toBe(false);
    expect(isCacheRef(42)).toBe(false);
    expect(isCacheRef(true)).toBe(false);
  });

  it("accepts a branded ref where $ref is the empty string (still string-typed)", () => {
    expect(isCacheRef(makeCacheRef({ $ref: "" }))).toBe(true);
  });

  it("does NOT confuse JSON-Schema $ref strings with cache refs", () => {
    // Before the kind brand, a shape-only check would have matched any
    // {$ref: string} — including JSON-Schema $refs in metadata or attacker
    // payloads pointing at other-run cache keys. With the brand, a JSON-Schema
    // ref no longer passes isCacheRef and the cache resolver will not walk it.
    const jsonSchemaRef = { $ref: "#/$defs/Foo" };
    expect(isCacheRef(jsonSchemaRef)).toBe(false);
  });
});

describe("makeCacheRef", () => {
  it("brands the constructed object with CACHE_REF_KIND", () => {
    const ref = makeCacheRef({ $ref: "cache://x" });
    expect(ref.kind).toBe(CACHE_REF_KIND);
  });

  it("omits size and mime when not supplied", () => {
    const ref = makeCacheRef({ $ref: "cache://x" });
    expect("size" in ref).toBe(false);
    expect("mime" in ref).toBe(false);
  });

  it("preserves size and mime when supplied", () => {
    const ref = makeCacheRef({ $ref: "cache://x", size: 99, mime: "image/png" });
    expect(ref.size).toBe(99);
    expect(ref.mime).toBe("image/png");
  });

  it("survives JSON round-trip and still passes isCacheRef", () => {
    const original = makeCacheRef({ $ref: "cache://round-trip", size: 7, mime: "text/plain" });
    const wire = JSON.stringify(original);
    const received = JSON.parse(wire);
    expect(isCacheRef(received)).toBe(true);
    expect(received.kind).toBe(CACHE_REF_KIND);
    expect(received.$ref).toBe("cache://round-trip");
    expect(received.size).toBe(7);
    expect(received.mime).toBe("text/plain");
  });
});

describe("resolveReferenceThreshold", () => {
  it("returns the default constant when threshold is undefined", () => {
    expect(resolveReferenceThreshold(undefined)).toBe(REFERENCE_THRESHOLD_BYTES_DEFAULT);
  });

  it("returns the configured threshold when set to a positive number", () => {
    expect(resolveReferenceThreshold(1024)).toBe(1024);
    expect(resolveReferenceThreshold(1_000_000)).toBe(1_000_000);
  });

  it("returns 0 when set to 0 (sentinel: always emit a reference)", () => {
    expect(resolveReferenceThreshold(0)).toBe(0);
  });

  it("falls back to the default when given a negative value", () => {
    expect(resolveReferenceThreshold(-1)).toBe(REFERENCE_THRESHOLD_BYTES_DEFAULT);
  });

  it("the default is 64 KiB", () => {
    expect(REFERENCE_THRESHOLD_BYTES_DEFAULT).toBe(65_536);
  });

  it("IRunConfig accepts referenceThresholdBytes as a number", () => {
    const cfg: IRunConfig = { referenceThresholdBytes: 0 };
    expect(resolveReferenceThreshold(cfg.referenceThresholdBytes)).toBe(0);
    const cfg2: IRunConfig = { referenceThresholdBytes: 2048 };
    expect(resolveReferenceThreshold(cfg2.referenceThresholdBytes)).toBe(2048);
    const cfg3: IRunConfig = {};
    expect(resolveReferenceThreshold(cfg3.referenceThresholdBytes)).toBe(
      REFERENCE_THRESHOLD_BYTES_DEFAULT
    );
  });
});
