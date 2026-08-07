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

  test("unrefTimer unrefs the scheduled timer without changing the schedule", async () => {
    // A running trigger otherwise keeps a Node process alive; the opt-out must
    // not change when it fires.
    const trigger = new IntervalTrigger({ intervalMs: PERIOD, unrefTimer: true });
    let fires = 0;
    trigger.start(() => {
      fires += 1;
    });

    await advanceFakeTimers(PERIOD * 3);
    expect(fires).toBe(3);

    await trigger.stop();
  });

  describe("listener errors", () => {
    test("a throwing skip listener does not escape the timer callback", async () => {
      // `skip` is emitted from inside a setTimeout callback, where a throw is an
      // uncaughtException — a `metrics.inc(...)` on a torn-down client would
      // take the whole process down.
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });
      const gate = createGate();
      const errors: Error[] = [];
      trigger.on("error", (error) => errors.push(error));
      trigger.on("skip", () => {
        throw new Error("skip listener boom");
      });

      let fires = 0;
      trigger.start(async () => {
        fires += 1;
        await gate.promise;
      });

      await advanceFakeTimers(PERIOD);
      expect(fires).toBe(1);

      await advanceFakeTimers(PERIOD);
      expect(errors.map((error) => error.message)).toContain("skip listener boom");

      // ...and the trigger is still a clock afterwards.
      gate.open();
      await flushAsyncWork();
      await advanceFakeTimers(PERIOD);
      expect(fires).toBe(2);
      expect(trigger.running).toBe(true);

      await trigger.stop();
    });

    test("a throwing stop listener does not produce an unhandled rejection", async () => {
      const rejections: unknown[] = [];
      const onRejection = (reason: unknown): void => {
        rejections.push(reason);
      };
      process.on("unhandledRejection", onRejection);
      try {
        const trigger = new IntervalTrigger({ intervalMs: PERIOD });
        const errors: Error[] = [];
        trigger.on("error", (error) => errors.push(error));
        trigger.on("stop", () => {
          throw new Error("stop listener boom");
        });

        const controller = new AbortController();
        trigger.start(() => {}, { signal: controller.signal });
        await advanceFakeTimers(PERIOD);

        // The caller-signal path stops the trigger from an event listener,
        // where there is no caller left to observe a rejected promise.
        controller.abort();
        await flushAsyncWork();

        expect(trigger.running).toBe(false);
        expect(errors.map((error) => error.message)).toContain("stop listener boom");
        expect(rejections).toEqual([]);
      } finally {
        process.off("unhandledRejection", onRejection);
      }
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

    test("a restart while stop() is draining is not clobbered by that stop()", async () => {
      // `stop()` releases the handler/signal only AFTER awaiting the in-flight
      // handler. A `start()` inside that window belongs to a new generation —
      // the old stop must not null out its state, or the trigger would report
      // `running` while never firing again.
      const gate = createGate();
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });

      let firstFires = 0;
      trigger.start(async () => {
        firstFires += 1;
        await gate.promise;
      });

      await advanceFakeTimers(PERIOD);
      expect(firstFires).toBe(1);

      // stop() blocks on the gated handler; restart before it settles.
      const stopping = trigger.stop();
      let secondFires = 0;
      trigger.start(() => {
        secondFires += 1;
      });
      gate.open();
      await stopping;

      expect(trigger.running).toBe(true);
      await advanceFakeTimers(PERIOD * 2);
      expect(secondFires).toBe(2);

      await trigger.stop();
    });

    test("a restart during stop() does not emit spurious skips (skip policy)", async () => {
      // The first generation's handler is still gated when the second starts.
      // Overlap state belongs to a RUN, not to the trigger: if the new
      // generation's ticks could see the old handler's in-flight count, every
      // one of them would be dropped as an overlap until the stale handler
      // happened to settle.
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });
      const gate = createGate();
      const skips: number[] = [];
      trigger.on("skip", (scheduledAt) => skips.push(scheduledAt));

      let gen1Fires = 0;
      trigger.start(async () => {
        gen1Fires += 1;
        await gate.promise;
      });

      await advanceFakeTimers(PERIOD);
      expect(gen1Fires).toBe(1);

      const stopping = trigger.stop();
      let gen2Fires = 0;
      trigger.start(() => {
        gen2Fires += 1;
      });

      // Advance BEFORE releasing the old handler: this is the window where the
      // stale run is still counted as in flight.
      await advanceFakeTimers(PERIOD * 2);
      expect(skips).toEqual([]);
      expect(gen2Fires).toBe(2);
      expect(gen1Fires).toBe(1);

      gate.open();
      await stopping;
      await trigger.stop();
    });

    test("a queued tick from the old generation is not delivered to the new handler", async () => {
      // Under a shared queue the OLD chain drains a tick the NEW generation
      // queued — invoking the new handler with the old, already-aborted signal.
      const trigger = new IntervalTrigger({
        intervalMs: PERIOD,
        overlap: "queue",
        maxQueuedFires: 1,
      });
      const gate = createGate();
      trigger.start(async () => {
        await gate.promise;
      });

      await advanceFakeTimers(PERIOD);

      const stopping = trigger.stop();
      const abortedOnArrival: boolean[] = [];
      trigger.start((context) => {
        abortedOnArrival.push(context.signal.aborted);
      });

      await advanceFakeTimers(PERIOD * 2);
      gate.open();
      await stopping;
      await flushAsyncWork();

      expect(abortedOnArrival.length).toBeGreaterThan(0);
      expect(abortedOnArrival).not.toContain(true);

      await trigger.stop();
    });

    test("stop() called twice concurrently resolves only after the handler settles", async () => {
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });
      const gate = createGate();
      let settled = false;
      trigger.start(async () => {
        await gate.promise;
        settled = true;
      });

      await advanceFakeTimers(PERIOD);

      const resolved: string[] = [];
      const first = trigger.stop().then(() => {
        resolved.push("first");
      });
      const second = trigger.stop().then(() => {
        resolved.push("second");
      });

      await flushAsyncWork();
      // Neither call may resolve while the handler is still running: `stop()`
      // means "no handler of this run is still in flight".
      expect(resolved).toEqual([]);
      expect(settled).toBe(false);

      gate.open();
      await Promise.all([first, second]);

      expect(settled).toBe(true);
      expect(resolved).toHaveLength(2);
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
