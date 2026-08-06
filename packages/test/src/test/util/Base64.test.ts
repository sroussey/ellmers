/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { base64ToBytes, bytesToBase64 } from "@workglow/util";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("bytesToBase64 / base64ToBytes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips bytes through base64 (Buffer fast path)", () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it("encodes a subarray view without leaking neighboring bytes", () => {
    const backing = Uint8Array.from([1, 2, 3, 4, 5]);
    const view = backing.subarray(1, 4);
    expect(Array.from(base64ToBytes(bytesToBase64(view)))).toEqual([2, 3, 4]);
  });

  it("browser path (no Buffer) matches the Buffer path across the 32 KiB block boundary", () => {
    const bytes = Uint8Array.from({ length: 0x8000 * 2 + 17 }, (_, i) => (i * 31) % 256);
    const viaBuffer = bytesToBase64(bytes);
    vi.stubGlobal("Buffer", undefined);
    const viaBlocks = bytesToBase64(bytes);
    expect(viaBlocks).toBe(viaBuffer);
    expect(Array.from(base64ToBytes(viaBlocks))).toEqual(Array.from(bytes));
  });
});
