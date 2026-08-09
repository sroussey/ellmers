/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { StreamEvent, StreamUsage } from "../StreamTypes";
import { streamEventCost } from "../StreamTypes";

describe("the usage stream event", () => {
  const usageEvent: StreamUsage = {
    type: "usage",
    usage: {
      input: 120,
      output: 8,
      cached: undefined,
      cacheWrite: undefined,
      reasoning: undefined,
      total: undefined,
      extra: undefined,
    },
  };

  it("is assignable to the StreamEvent union", () => {
    const event: StreamEvent = usageEvent;
    expect(event.type).toBe("usage");
  });

  it("costs nothing for backpressure accounting", () => {
    // Usage is a control event, like phase and finish: a slow consumer does not
    // buffer up on it, so charging for it would throttle the producer for free.
    expect(streamEventCost(usageEvent)).toBe(0);
  });
});
