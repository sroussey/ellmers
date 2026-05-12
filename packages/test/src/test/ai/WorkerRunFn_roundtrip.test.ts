/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkerManager, WorkerServerBase } from "@workglow/util/worker";
import type { StreamEvent } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

describe("WorkerManager.callWorkerRunFunction round-trip", () => {
  it("WorkerManager + WorkerServerBase exports are available", () => {
    // Smoke import — a full worker round-trip requires a real Worker harness
    // and is validated by provider tests that use workers (HFT in worker mode).
    expect(typeof WorkerManager).toBe("function");
    expect(typeof WorkerServerBase).toBe("function");
  });
});
