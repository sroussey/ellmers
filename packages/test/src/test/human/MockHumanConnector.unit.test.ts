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

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  return e.name === "AbortError" || /abort/i.test(e.message ?? "");
}

describe("MockHumanConnector — deferred + abort", () => {
  it("blocks send() until release()", async () => {
    const c = new MockHumanConnector();
    const handle = c.script.pushDeferred();
    const ac = new AbortController();
    const promise = c.send(elicitReq("r1"), ac.signal);
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    handle.release({ requestId: "x", action: "accept", content: { ok: 1 }, done: true });
    const res = await promise;
    expect(res.action).toBe("accept");
    expect(res.content).toEqual({ ok: 1 });
  });

  it("rejects with AbortError when signal is already aborted before send", async () => {
    const c = new MockHumanConnector();
    const ac = new AbortController();
    ac.abort();
    let caught: unknown;
    try {
      await c.send(elicitReq("r1"), ac.signal);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(isAbortError(caught)).toBe(true);
  });

  it("rejects with AbortError when signal aborts during a deferred wait", async () => {
    const c = new MockHumanConnector();
    c.script.pushDeferred();
    const ac = new AbortController();
    const promise = c.send(elicitReq("r1"), ac.signal);
    setTimeout(() => ac.abort(), 10);
    let caught: unknown;
    try {
      await promise;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(isAbortError(caught)).toBe(true);
  });

  it("releasing after rejection is a no-op (does not throw, does not affect later sends)", async () => {
    const c = new MockHumanConnector();
    const handle = c.script.pushDeferred();
    const ac = new AbortController();
    const promise = c.send(elicitReq("r1"), ac.signal);
    setTimeout(() => ac.abort(), 5);
    try {
      await promise;
    } catch {
      // expected abort
    }
    expect(() =>
      handle.release({ requestId: "x", action: "accept", content: undefined, done: true })
    ).not.toThrow();
    const res = await c.send(elicitReq("r2"), new AbortController().signal);
    expect(res.action).toBe("accept");
  });
});
