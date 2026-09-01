/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { INITIAL_LIVENESS, reduceHeartbeat } from "./heartbeat";

describe("reduceHeartbeat", () => {
  it("starts online, because the page was served by the CLI a moment ago", () => {
    // Disabling every control for the first second of a page load would be its
    // own bug: nothing is known to be wrong yet.
    expect(INITIAL_LIVENESS.online).toBe(true);
  });

  it("goes offline on a failed probe and back on the next answer", () => {
    const first = reduceHeartbeat(INITIAL_LIVENESS, { ok: true, startedAt: 100 });
    const down = reduceHeartbeat(first, { ok: false });
    expect(down.online).toBe(false);
    const up = reduceHeartbeat(down, { ok: true, startedAt: 100 });
    expect(up.online).toBe(true);
  });

  it("keeps the process identity across an outage, so a pause is not a restart", () => {
    // The runs on screen belong to that process. Forgetting which one we were
    // talking to would make every recovery look like a restart and tell the
    // operator their runs were gone when they are still there.
    const up = reduceHeartbeat(INITIAL_LIVENESS, { ok: true, startedAt: 100 });
    const down = reduceHeartbeat(up, { ok: false });
    expect(down.startedAt).toBe(100);
    const back = reduceHeartbeat(down, { ok: true, startedAt: 100 });
    expect(back.restarted).toBe(false);
  });

  it("reports a restart when a DIFFERENT process answers", () => {
    const up = reduceHeartbeat(INITIAL_LIVENESS, { ok: true, startedAt: 100 });
    const down = reduceHeartbeat(up, { ok: false });
    const other = reduceHeartbeat(down, { ok: true, startedAt: 200 });
    expect(other.online).toBe(true);
    // Reachable, but it remembers none of the runs the page is showing.
    expect(other.restarted).toBe(true);
  });

  it("treats the first answer as establishing identity, not as a restart", () => {
    const first = reduceHeartbeat(INITIAL_LIVENESS, { ok: true, startedAt: 100 });
    expect(first.restarted).toBe(false);
    expect(first.startedAt).toBe(100);
  });
});
