/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  isCacheRef,
  REFERENCE_THRESHOLD_BYTES_DEFAULT,
  resolveReferenceThreshold,
} from "@workglow/task-graph";
import type { CacheRef, IRunConfig } from "@workglow/task-graph";

describe("isCacheRef", () => {
  it("accepts a minimal ref carrying only $ref", () => {
    const ref: CacheRef = { $ref: "cache://k1" };
    expect(isCacheRef(ref)).toBe(true);
  });

  it("accepts a ref carrying size and mime hints", () => {
    const ref: CacheRef = { $ref: "cache://k2", size: 1024, mime: "audio/wav" };
    expect(isCacheRef(ref)).toBe(true);
  });

  it("rejects values without a string $ref", () => {
    expect(isCacheRef({})).toBe(false);
    expect(isCacheRef({ ref: "cache://k" })).toBe(false);
    expect(isCacheRef({ $ref: 42 })).toBe(false);
    expect(isCacheRef({ $ref: null })).toBe(false);
  });

  it("rejects primitives and null", () => {
    expect(isCacheRef(null)).toBe(false);
    expect(isCacheRef(undefined)).toBe(false);
    expect(isCacheRef("cache://k")).toBe(false);
    expect(isCacheRef(42)).toBe(false);
    expect(isCacheRef(true)).toBe(false);
  });

  it("accepts a ref where $ref is the empty string (still string-typed)", () => {
    expect(isCacheRef({ $ref: "" })).toBe(true);
  });

  it("does not confuse JSON-Schema $ref strings with cache refs by shape", () => {
    // JSON Schema $ref also uses { $ref: string }. Shape is identical at this
    // layer; discrimination by call site / port-context is the contract, not
    // shape inspection. This test documents the limitation.
    const jsonSchemaRef = { $ref: "#/definitions/Foo" };
    expect(isCacheRef(jsonSchemaRef)).toBe(true);
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
