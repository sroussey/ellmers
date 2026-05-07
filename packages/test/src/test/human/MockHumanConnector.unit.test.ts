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

describe("MockHumanConnector — scripted", () => {
  it("consumes pushed responses FIFO", async () => {
    const c = new MockHumanConnector();
    c.script.push({ requestId: "ignored", action: "decline", content: undefined, done: true });
    c.script.push((req) => ({
      requestId: req.requestId,
      action: "accept",
      content: { ok: true },
      done: true,
    }));

    const a = await c.send(elicitReq("r1"), new AbortController().signal);
    const b = await c.send(elicitReq("r2"), new AbortController().signal);

    expect(a.action).toBe("decline");
    // Pushed exact responses still echo the actual requestId from the request,
    // so consumers can rely on requestId being correct regardless of script entry.
    expect(a.requestId).toBe("r1");
    expect(b.action).toBe("accept");
    expect(b.requestId).toBe("r2");
    expect(b.content).toEqual({ ok: true });
  });

  it("falls back to default action once the queue is drained", async () => {
    const c = new MockHumanConnector();
    c.script.push({ requestId: "x", action: "decline", content: undefined, done: true });
    const ac = new AbortController();
    const a = await c.send(elicitReq("r1"), ac.signal);
    const b = await c.send(elicitReq("r2"), ac.signal);
    expect(a.action).toBe("decline");
    expect(b.action).toBe("accept");
  });

  it("clear() empties queue and received history", async () => {
    const c = new MockHumanConnector();
    c.script.push({ requestId: "x", action: "decline", content: undefined, done: true });
    await c.send(elicitReq("r1"), new AbortController().signal);
    expect(c.script.received).toHaveLength(1);
    c.script.clear();
    expect(c.script.received).toHaveLength(0);
    const after = await c.send(elicitReq("r2"), new AbortController().signal);
    expect(after.action).toBe("accept");
  });
});
