/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { STATIC_SIGNAL_SOURCE, type EntitlementSignal } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

describe("STATIC_SIGNAL_SOURCE", () => {
  it("subscribe returns a no-op unsubscribe and never invokes the listener", () => {
    const calls: EntitlementSignal[] = [];
    const unsub = STATIC_SIGNAL_SOURCE.subscribe((s) => calls.push(s));
    expect(typeof unsub).toBe("function");
    // Calling unsub repeatedly must not throw.
    unsub();
    unsub();
    expect(calls).toEqual([]);
  });
});
