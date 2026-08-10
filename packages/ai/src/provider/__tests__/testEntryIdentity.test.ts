/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _aiInternal, getCheckpoint, registerCheckpoint } from "@workglow/ai";
import { AiVisionTask, clearCheckpoints } from "@workglow/ai/test";
import { describe, expect, it } from "vitest";

/**
 * The `./test` entry must resolve to the SAME module instance as the public
 * entry. Each is its own `bun build --packages=external` bundle, so a relative
 * import in the test entry would bundle a second checkpoint registry —
 * `clearCheckpoints()` would empty a map nothing else reads, and `AiVisionTask`
 * would be a different class than the one subclasses extend.
 *
 * Both sides are imported by PACKAGE SPECIFIER on purpose, because that is what
 * a consumer does. Importing one side relatively compares source against `dist`
 * and fails in dist mode for a reason that says nothing about the packaging.
 */
describe("@workglow/ai/test entry", () => {
  it("re-exports the same objects as the package's own bag", () => {
    expect(AiVisionTask).toBe(_aiInternal.AiVisionTask);
    expect(clearCheckpoints).toBe(_aiInternal.clearCheckpointsForTesting);
  });

  it("clears the registry the public entry reads from", () => {
    registerCheckpoint("identity-probe", {
      provider: "test",
      modelKey: "",
      prefix: { messages: [] },
      modelId: undefined,
    });
    expect(getCheckpoint("identity-probe")).toBeDefined();
    clearCheckpoints();
    expect(getCheckpoint("identity-probe")).toBeUndefined();
  });
});
