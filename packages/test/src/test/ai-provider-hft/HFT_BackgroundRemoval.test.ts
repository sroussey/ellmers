/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { rawImageToImageValue } from "@workglow/huggingface-transformers/ai-runtime";
import { describe, expect, it, vi } from "vitest";

/**
 * `RawImage` carries different encoders per runtime — `toBlob()` is
 * canvas-backed and browser-only, `toSharp()` is node-only — and transformers.js
 * has changed which of them exist. The run-fn probes rather than assuming, so
 * the probe order and the failure message are pinned here.
 */
describe("rawImageToImageValue", () => {
  // A 1x1 transparent PNG — the smallest thing sharp will accept.
  const PNG_1X1 = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    ),
    (c) => c.charCodeAt(0)
  );

  it("prefers toBlob when the runtime provides it", async () => {
    const toBlob = vi.fn(async () => new Blob([PNG_1X1], { type: "image/png" }));
    const toSharp = vi.fn();

    const value = await rawImageToImageValue({ toBlob, toSharp });

    expect(toBlob).toHaveBeenCalledWith("image/png");
    expect(toSharp).not.toHaveBeenCalled();
    expect(value).toBeDefined();
  });

  it("falls back to toSharp when toBlob is absent", async () => {
    const toBuffer = vi.fn(async () => PNG_1X1);
    const toSharp = vi.fn(() => ({ png: () => ({ toBuffer }) }));

    const value = await rawImageToImageValue({ toSharp });

    expect(toBuffer).toHaveBeenCalled();
    expect(value).toBeDefined();
  });

  it("throws a diagnosable error when neither encoder exists", async () => {
    // The transformers 4.2.0 shape that made the previous `toBase64` call fail:
    // a RawImage with neither encoder must name both, not just one.
    await expect(rawImageToImageValue({})).rejects.toThrow(/toBlob\(\) nor toSharp\(\)/);
  });
});
