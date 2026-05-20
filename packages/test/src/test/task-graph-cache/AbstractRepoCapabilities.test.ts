/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskOutputRepository } from "@workglow/task-graph";
import { describe, expect, it, vi } from "vitest";

/**
 * Minimal concrete subclass that implements only the truly-abstract methods.
 * Leaves the three default-throwing prefix-aware methods as their base defaults.
 */
class MinimalRepo extends TaskOutputRepository {
  constructor() {
    super({ outputCompression: false });
  }

  saveOutput = vi.fn().mockResolvedValue(undefined);
  getOutput = vi.fn().mockResolvedValue(undefined);
  clear = vi.fn().mockResolvedValue(undefined);
  size = vi.fn().mockResolvedValue(0);
  clearOlderThan = vi.fn().mockResolvedValue(undefined);
  isDurable() {
    return false;
  }
}

describe("TaskOutputRepository default-throwing prefix-aware methods", () => {
  it("deleteByTaskTypePrefix throws by default", async () => {
    const r = new MinimalRepo();
    await expect(r.deleteByTaskTypePrefix("some-prefix::")).rejects.toThrow(/not supported/);
  });

  it("clearOlderThanWithTaskTypePrefix throws by default", async () => {
    const r = new MinimalRepo();
    await expect(r.clearOlderThanWithTaskTypePrefix("some-prefix::", 86400_000)).rejects.toThrow(
      /not supported/
    );
  });

  it("sizeByTaskTypePrefix throws by default", async () => {
    const r = new MinimalRepo();
    await expect(r.sizeByTaskTypePrefix("some-prefix::")).rejects.toThrow(/not supported/);
  });
});
