/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskOutputRepository } from "@workglow/task-graph";
import { describe, expect, it, vi } from "vitest";

/**
 * Minimal concrete subclass that implements only the truly-abstract methods.
 * Leaves the run-scoped methods as their base defaults, which throw — only a
 * run-private backing (RunPrivateTaskOutputRepository) implements them.
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

describe("TaskOutputRepository default-throwing run-scoped methods", () => {
  it("saveOutputForRun throws by default", async () => {
    const r = new MinimalRepo();
    await expect(r.saveOutputForRun("run", "T", { x: 1 }, { r: 1 })).rejects.toThrow(
      /not supported/
    );
  });

  it("getOutputForRun throws by default", async () => {
    const r = new MinimalRepo();
    await expect(r.getOutputForRun("run", "T", { x: 1 })).rejects.toThrow(/not supported/);
  });

  it("deleteRun throws by default", async () => {
    const r = new MinimalRepo();
    await expect(r.deleteRun("run")).rejects.toThrow(/not supported/);
  });

  it("deleteRunOlderThan throws by default", async () => {
    const r = new MinimalRepo();
    await expect(r.deleteRunOlderThan("run", 86400_000)).rejects.toThrow(/not supported/);
  });

  it("sizeForRun throws by default", async () => {
    const r = new MinimalRepo();
    await expect(r.sizeForRun("run")).rejects.toThrow(/not supported/);
  });
});
