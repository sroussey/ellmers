/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { rawImageToImageValue } from "@workglow/huggingface-transformers/ai-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A real `RawImage` carries BOTH encoders on its prototype in every runtime —
 * `toBlob()` throws "only supported in browser environments" off-web and
 * `toSharp()` throws the mirror on-web. Method existence therefore says nothing
 * about usability, so what is pinned here is the runtime-ordered attempt and the
 * recovery when the first guess is the wrong one.
 */
describe("rawImageToImageValue", () => {
  // A 1x1 transparent PNG — the smallest thing sharp will accept.
  const PNG_1X1 = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    ),
    (c) => c.charCodeAt(0)
  );

  const workingToBlob = () => vi.fn(async () => new Blob([PNG_1X1], { type: "image/png" }));
  const workingToSharp = () => {
    const toBuffer = vi.fn(async () => PNG_1X1);
    const toSharp = vi.fn(() => ({ png: () => ({ toBuffer }) }));
    return { toSharp, toBuffer };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses toSharp when toBlob throws the browser-only error (the real 4.2.0 Node shape)", async () => {
    const toBlob = vi.fn(async () => {
      throw new Error("toBlob() is only supported in browser environments.");
    });
    const { toSharp, toBuffer } = workingToSharp();

    const value = await rawImageToImageValue({ toBlob, toSharp });

    expect(toBuffer).toHaveBeenCalled();
    expect(value).toBeDefined();
  });

  it("uses toBlob when toSharp throws the server-only error (the real 4.2.0 browser shape)", async () => {
    const toBlob = workingToBlob();
    const toSharp = vi.fn(() => {
      throw new Error("toSharp() is only supported in server-side environments.");
    }) as unknown as () => { png: () => { toBuffer: () => Promise<Uint8Array> } };

    const value = await rawImageToImageValue({ toBlob, toSharp });

    expect(toBlob).toHaveBeenCalledWith("image/png");
    expect(value).toBeDefined();
  });

  it("tries toSharp first off-web so the browser encoder is never probed", async () => {
    const toBlob = workingToBlob();
    const { toSharp, toBuffer } = workingToSharp();

    const value = await rawImageToImageValue({ toBlob, toSharp });

    expect(toBuffer).toHaveBeenCalled();
    expect(toBlob).not.toHaveBeenCalled();
    expect(value).toBeDefined();
  });

  it("tries toBlob first on web", async () => {
    const toBlob = workingToBlob();
    const { toSharp } = workingToSharp();

    vi.stubGlobal("OffscreenCanvas", class {});
    try {
      const value = await rawImageToImageValue({ toBlob, toSharp });

      expect(toBlob).toHaveBeenCalledWith("image/png");
      expect(toSharp).not.toHaveBeenCalled();
      expect(value).toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports both encoder failures when neither works", async () => {
    const toBlob = vi.fn(async () => {
      throw new Error("toBlob() is only supported in browser environments.");
    });
    const toSharp = vi.fn(() => {
      throw new Error("Could not load the sharp module");
    }) as unknown as () => { png: () => { toBuffer: () => Promise<Uint8Array> } };

    const error = await rawImageToImageValue({ toBlob, toSharp }).then(
      () => undefined,
      (e: unknown) => e as Error
    );

    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain("only supported in browser environments");
    expect(error!.message).toContain("Could not load the sharp module");
  });

  it("throws a diagnosable error when neither encoder exists", async () => {
    // A transformers version shipping neither encoder must name both, not just one.
    await expect(rawImageToImageValue({})).rejects.toThrow(/toBlob\(\) nor toSharp\(\)/);
  });
});
