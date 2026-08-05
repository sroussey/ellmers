/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITriggerFireContext } from "@workglow/triggers";
import { IntervalTrigger, TriggerConfigurationError } from "@workglow/triggers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { advanceFakeTimers, flushAsyncWork } from "../helpers/advanceFakeTimers";

const START = Date.UTC(2026, 0, 1, 0, 0, 0);
const PERIOD = 100;

interface Gate {
  readonly promise: Promise<void>;
  readonly open: () => void;
}

function createGate(): Gate {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe("IntervalTrigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("rejects a non-positive or non-integer period", () => {
    expect(() => new IntervalTrigger({ intervalMs: 0 })).toThrow(TriggerConfigurationError);
    expect(() => new IntervalTrigger({ intervalMs: -5 })).toThrow(TriggerConfigurationError);
    expect(() => new IntervalTrigger({ intervalMs: 1.5 })).toThrow(TriggerConfigurationError);
    expect(() => new IntervalTrigger({ intervalMs: Number.NaN })).toThrow(
      TriggerConfigurationError
    );
  });

  test("rejects an unknown overlap policy", () => {
    expect(() => new IntervalTrigger({ intervalMs: PERIOD, overlap: "whenever" as never })).toThrow(
      TriggerConfigurationError
    );
  });

  test("does not fire before a full period has elapsed", async () => {
    const trigger = new IntervalTrigger({ intervalMs: PERIOD });
    const fires: number[] = [];
    trigger.start((context) => {
      fires.push(context.scheduledAt);
    });

    await advanceFakeTimers(PERIOD - 1);
    expect(fires).toEqual([]);

    await advanceFakeTimers(1);
    expect(fires).toEqual([START + PERIOD]);

    await trigger.stop();
  });

  test("fires exactly N times over N periods", async () => {
    const trigger = new IntervalTrigger({ intervalMs: PERIOD });
    let fires = 0;
    trigger.start(() => {
      fires += 1;
    });

    await advanceFakeTimers(PERIOD * 7);
    expect(fires).toBe(7);

    await trigger.stop();
  });

  test("does not drift over 100 periods", async () => {
    const trigger = new IntervalTrigger({ intervalMs: PERIOD });
    const scheduled: number[] = [];
    trigger.start((context) => {
      scheduled.push(context.scheduledAt);
      expect(Date.now()).toBe(context.scheduledAt);
    });

    await advanceFakeTimers(PERIOD * 100);

    expect(scheduled).toHaveLength(100);
    const expected = Array.from({ length: 100 }, (_, i) => START + (i + 1) * PERIOD);
    expect(scheduled).toEqual(expected);
    // The 100th fire lands on the exact multiple — no accumulated slippage.
    expect(scheduled[99]).toBe(START + 100 * PERIOD);

    await trigger.stop();
  });

  test("stop() halts further fires", async () => {
    const trigger = new IntervalTrigger({ intervalMs: PERIOD });
    let fires = 0;
    trigger.start(() => {
      fires += 1;
    });

    await advanceFakeTimers(PERIOD * 2);
    expect(fires).toBe(2);
    expect(trigger.running).toBe(true);

    await trigger.stop();
    expect(trigger.running).toBe(false);

    await advanceFakeTimers(PERIOD * 5);
    expect(fires).toBe(2);
  });

  test("stop() is idempotent and emits stop once", async () => {
    const trigger = new IntervalTrigger({ intervalMs: PERIOD });
    let stops = 0;
    trigger.on("stop", () => {
      stops += 1;
    });
    trigger.start(() => {});

    await trigger.stop();
    await trigger.stop();
    expect(stops).toBe(1);
  });

  test("a second start() is a no-op and leaves no extra timer", async () => {
    const trigger = new IntervalTrigger({ intervalMs: PERIOD });
    let starts = 0;
    trigger.on("start", () => {
      starts += 1;
    });
    let fires = 0;
    const handler = (): void => {
      fires += 1;
    };

    trigger.start(handler);
    trigger.start(handler);
    expect(starts).toBe(1);

    await advanceFakeTimers(PERIOD * 3);
    expect(fires).toBe(3);

    await trigger.stop();
    await advanceFakeTimers(PERIOD * 3);
    expect(fires).toBe(3);
  });

  test("a handler rejection does not stop the loop and emits the real Error", async () => {
    const trigger = new IntervalTrigger({ intervalMs: PERIOD });
    const errors: Error[] = [];
    trigger.on("error", (error) => {
      errors.push(error);
    });

    let fires = 0;
    trigger.start(async () => {
      fires += 1;
      throw new TypeError(`boom ${fires}`);
    });

    await advanceFakeTimers(PERIOD * 3);

    expect(fires).toBe(3);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toBeInstanceOf(TypeError);
    expect(errors[0]?.message).toBe("boom 1");

    await trigger.stop();
  });

  test("a thrown non-Error is wrapped rather than dropped", async () => {
    const trigger = new IntervalTrigger({ intervalMs: PERIOD });
    const errors: Error[] = [];
    trigger.on("error", (error) => errors.push(error));
    trigger.start(() => {
      throw "plain string";
    });

    await advanceFakeTimers(PERIOD);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(errors[0]?.message).toBe("plain string");

    await trigger.stop();
  });

  describe("overlap policies", () => {
    test("skip (default) drops ticks while a handler is in flight", async () => {
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });
      const gate = createGate();
      const fired: number[] = [];
      const skipped: number[] = [];
      trigger.on("skip", (scheduledAt) => skipped.push(scheduledAt));

      trigger.start(async (context) => {
        fired.push(context.scheduledAt);
        await gate.promise;
      });

      await advanceFakeTimers(PERIOD);
      expect(fired).toEqual([START + PERIOD]);

      await advanceFakeTimers(PERIOD * 2);
      expect(fired).toEqual([START + PERIOD]);
      expect(skipped).toEqual([START + PERIOD * 2, START + PERIOD * 3]);

      gate.open();
      await flushAsyncWork();

      await advanceFakeTimers(PERIOD);
      expect(fired).toEqual([START + PERIOD, START + PERIOD * 4]);

      await trigger.stop();
    });

    test("queue holds one missed tick and runs it after the handler settles", async () => {
      const trigger = new IntervalTrigger({
        intervalMs: PERIOD,
        overlap: "queue",
        maxQueuedFires: 1,
      });
      const gate = createGate();
      const fired: number[] = [];
      const skipped: number[] = [];
      trigger.on("skip", (scheduledAt) => skipped.push(scheduledAt));

      trigger.start(async (context) => {
        fired.push(context.scheduledAt);
        await gate.promise;
      });

      await advanceFakeTimers(PERIOD * 3);
      // Tick 1 ran; tick 2 was queued; tick 3 exceeded the bound and was skipped.
      expect(fired).toEqual([START + PERIOD]);
      expect(skipped).toEqual([START + PERIOD * 3]);

      gate.open();
      await flushAsyncWork();
      // The queued tick keeps its own scheduled instant.
      expect(fired).toEqual([START + PERIOD, START + PERIOD * 2]);

      await trigger.stop();
    });

    test("concurrent invokes the handler regardless of what is in flight", async () => {
      const trigger = new IntervalTrigger({ intervalMs: PERIOD, overlap: "concurrent" });
      const gate = createGate();
      const fired: number[] = [];
      const skipped: number[] = [];
      trigger.on("skip", (scheduledAt) => skipped.push(scheduledAt));

      trigger.start(async (context) => {
        fired.push(context.scheduledAt);
        await gate.promise;
      });

      await advanceFakeTimers(PERIOD * 3);
      expect(fired).toEqual([START + PERIOD, START + PERIOD * 2, START + PERIOD * 3]);
      expect(skipped).toEqual([]);

      gate.open();
      await flushAsyncWork();
      await trigger.stop();
    });

    test("rejects a non-positive queue bound", () => {
      expect(
        () => new IntervalTrigger({ intervalMs: PERIOD, overlap: "queue", maxQueuedFires: 0 })
      ).toThrow(TriggerConfigurationError);
    });
  });

  describe("abort", () => {
    test("stop() aborts the signal handed to the handler and waits for it to settle", async () => {
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });
      const gate = createGate();
      let context: ITriggerFireContext | undefined;
      let settled = false;

      trigger.start(async (fireContext) => {
        context = fireContext;
        await gate.promise;
        settled = true;
      });

      await advanceFakeTimers(PERIOD);
      expect(context?.signal.aborted).toBe(false);

      const stopping = trigger.stop();
      expect(context?.signal.aborted).toBe(true);
      expect(settled).toBe(false);

      gate.open();
      await stopping;
      expect(settled).toBe(true);
      expect(trigger.running).toBe(false);
    });

    test("a caller signal stops the trigger when it aborts", async () => {
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });
      const controller = new AbortController();
      let fires = 0;
      trigger.start(
        () => {
          fires += 1;
        },
        { signal: controller.signal }
      );

      await advanceFakeTimers(PERIOD * 2);
      expect(fires).toBe(2);

      controller.abort();
      await flushAsyncWork();
      expect(trigger.running).toBe(false);

      await advanceFakeTimers(PERIOD * 3);
      expect(fires).toBe(2);
    });

    test("an already-aborted caller signal schedules nothing", async () => {
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });
      let fires = 0;
      trigger.start(
        () => {
          fires += 1;
        },
        { signal: AbortSignal.abort() }
      );

      expect(trigger.running).toBe(false);
      await advanceFakeTimers(PERIOD * 3);
      expect(fires).toBe(0);
    });
  });
});
