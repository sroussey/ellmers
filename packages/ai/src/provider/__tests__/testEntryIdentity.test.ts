/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { _internal } from "../../common";
import { AiVisionTask, clearCheckpoints } from "../../test-entry";
import { getCheckpoint, registerCheckpoint } from "../CheckpointRegistry";

/**
 * The `./test` entry must resolve to the SAME module instance as the public
 * entry. Each is its own `bun build --packages=external` bundle, so a relative
 * import in the test entry would bundle a second checkpoint registry —
 * `clearCheckpoints()` would empty a map nothing else reads, and `AiVisionTask`
 * would be a different class than the one subclasses extend.
 */
describe("@workglow/ai/test entry", () => {
  it("re-exports the same objects as the package's own bag", () => {
    expect(AiVisionTask).toBe(_internal.AiVisionTask);
    expect(clearCheckpoints).toBe(_internal.clearCheckpointsForTesting);
  });

  it("clears the registry the public entry reads from", () => {
    registerCheckpoint("identity-probe", {
      provider: "test",
      modelKey: "",
      prefix: { messages: [] },
    });
    expect(getCheckpoint("identity-probe")).toBeDefined();
    clearCheckpoints();
    expect(getCheckpoint("identity-probe")).toBeUndefined();
  });
});
