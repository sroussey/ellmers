/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _utilMediaInternal } from "@workglow/util/media";
import { resetGpuDeviceForTests, resetTexturePoolForTests } from "@workglow/util/test";
import { describe, expect, it } from "vitest";

/**
 * The `./test` entry must resolve to the SAME module instance as the package's
 * public entry, not a second copy of it.
 *
 * Each entry is built by its own `bun build --packages=external` pass, so a test
 * entry that imported `./media/texturePool.browser` directly would bundle its own
 * copy — a reset that clears a pool nothing else is using, failing silently and
 * looking like a flaky test. Reaching the symbols through the public entry keeps
 * them external and shared. These assertions fail the moment someone "simplifies"
 * the test entry into a direct import.
 *
 * Both sides are imported by PACKAGE SPECIFIER on purpose, because that is what
 * a consumer does. Importing one side relatively compares source against `dist`
 * and fails in dist mode for a reason that says nothing about the packaging.
 */
describe("@workglow/util/test entry", () => {
  it("re-exports the same function objects as the package's own bag", () => {
    expect(resetGpuDeviceForTests).toBe(_utilMediaInternal.resetGpuDeviceForTests);
    expect(resetTexturePoolForTests).toBe(_utilMediaInternal.resetTexturePoolForTests);
  });

  it("exposes callable reset hooks", () => {
    expect(typeof resetGpuDeviceForTests).toBe("function");
    expect(typeof resetTexturePoolForTests).toBe("function");
    expect(() => {
      resetGpuDeviceForTests();
      resetTexturePoolForTests();
    }).not.toThrow();
  });
});
