/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for {@link BackpressureGate} — the cost-agnostic park/wake
 * primitive shared by the binary stream router and the per-port transport
 * gates. The gate accounts buffered "cost" (bytes, characters, whatever the
 * caller charges), parks a producer that crosses the high-water mark, and
 * releases it once a consumer credits enough back to drop below the mark.
 */

import { BackpressureGate } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

/** Resolves on the next macrotask so we can assert a promise has NOT settled. */
function tick(): Promise<void> {
  return new Promise((res) => setTimeout(res, 0));
}

/** Tracks whether a promise has settled without awaiting it. */
function settle<T>(p: Promise<T>): { settled: () => boolean } {
  let done = false;
  p.then(
    () => (done = true),
    () => (done = true)
  );
  return { settled: () => done };
}

describe("BackpressureGate", () => {
  it("resolves charge immediately while under the high-water mark", async () => {
    const gate = new BackpressureGate(10);
    await gate.charge(5);
    expect(gate._bufferedCost).toBe(5);
    await gate.charge(4);
    expect(gate._bufferedCost).toBe(9);
  });

  it("parks a charge that crosses the mark until a credit drops below it", async () => {
    const gate = new BackpressureGate(10);
    await gate.charge(5);
    const parked = gate.charge(8); // bufferedCost = 13 >= 10 -> parks
    const probe = settle(parked);
    await tick();
    expect(probe.settled()).toBe(false);
    expect(gate._bufferedCost).toBe(13);

    gate.credit(5); // bufferedCost = 8 < 10 -> wake
    await parked; // must resolve now
    expect(gate._bufferedCost).toBe(8);
  });

  it("releases ALL parked producers when a single credit crosses below the mark", async () => {
    const gate = new BackpressureGate(10);
    await gate.charge(5);
    const p1 = settle(gate.charge(8)); // 13 -> parked
    const p2 = settle(gate.charge(3)); // 16 -> parked
    await tick();
    expect(p1.settled()).toBe(false);
    expect(p2.settled()).toBe(false);

    gate.credit(10); // 6 < 10 -> wake all chained waiters
    await tick();
    expect(p1.settled()).toBe(true);
    expect(p2.settled()).toBe(true);
  });

  it("does not wake while still at or above the mark", async () => {
    const gate = new BackpressureGate(10);
    // First charge over the mark parks too (matches BinaryStreamRouter.push):
    // the crossing item is buffered, then the producer waits for drain.
    const parked = settle(gate.charge(20)); // 20 -> parked
    await tick();
    expect(parked.settled()).toBe(false);
    gate.credit(3); // 17 still >= 10 -> no wake
    await tick();
    expect(parked.settled()).toBe(false);
    gate.credit(15); // 2 < 10 -> wake
    await tick();
    expect(parked.settled()).toBe(true);
  });

  it("close() releases parked producers and makes later charges no-ops", async () => {
    const gate = new BackpressureGate(10);
    const parked = settle(gate.charge(50)); // 50 -> parked
    await tick();
    expect(parked.settled()).toBe(false);

    gate.close();
    await tick();
    expect(parked.settled()).toBe(true);
    expect(gate.closed).toBe(true);

    // A charge after close resolves immediately and does not accumulate.
    await gate.charge(999);
  });

  it("fail(err) releases parked producers and records the failure", async () => {
    const gate = new BackpressureGate(10);
    const parked = settle(gate.charge(50)); // 50 -> parked
    await tick();
    expect(parked.settled()).toBe(false);

    const err = new Error("boom");
    gate.fail(err);
    await tick();
    expect(parked.settled()).toBe(true);
    expect(gate.closed).toBe(true);
    expect(gate.failure).toBe(err);
  });

  it("awaitBelowMark resolves immediately under the mark and parks at/over it", async () => {
    const gate = new BackpressureGate(10);
    await gate.awaitBelowMark(); // empty -> immediate
    const charged = settle(gate.charge(12)); // 12 -> parks
    const waiting = settle(gate.awaitBelowMark()); // over mark -> parks
    await tick();
    expect(waiting.settled()).toBe(false);
    gate.credit(5); // 7 < 10 -> wake both
    await tick();
    expect(charged.settled()).toBe(true);
    expect(waiting.settled()).toBe(true);
  });

  it("awaitBelowMark resolves immediately once closed", async () => {
    const gate = new BackpressureGate(10);
    settle(gate.charge(50)); // parks; released by close below
    gate.close();
    await gate.awaitBelowMark(); // closed -> immediate
  });

  it("clamps a non-positive high-water mark up to 1", () => {
    expect(new BackpressureGate(0)._highWaterMark).toBe(1);
    expect(new BackpressureGate(-5)._highWaterMark).toBe(1);
  });
});
