/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IHumanRequest } from "@workglow/util";
import { describe, expect, it } from "vitest";

import { MockHumanConnector } from "../../contract/human-connector/MockHumanConnector";

function elicitReq(requestId: string): IHumanRequest {
  return {
    requestId,
    targetHumanId: "default",
    kind: "elicit",
    message: "test",
    contentSchema: { type: "object", properties: {}, additionalProperties: true },
    contentData: undefined,
    expectsResponse: true,
    mode: "single",
    metadata: undefined,
  };
}

describe("MockHumanConnector — defaults", () => {
  it("auto-accepts when no script entry is queued", async () => {
    const c = new MockHumanConnector();
    const ac = new AbortController();
    const res = await c.send(elicitReq("r1"), ac.signal);
    expect(res.requestId).toBe("r1");
    expect(res.action).toBe("accept");
    expect(res.done).toBe(true);
    expect(res.content).toBeUndefined();
  });

  it("records every request received", async () => {
    const c = new MockHumanConnector();
    const ac = new AbortController();
    await c.send(elicitReq("r1"), ac.signal);
    await c.send(elicitReq("r2"), ac.signal);
    expect(c.script.received.map((r) => r.requestId)).toEqual(["r1", "r2"]);
  });
});
