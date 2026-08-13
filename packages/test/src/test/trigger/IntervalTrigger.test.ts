/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITriggerFireContext } from "@workglow/triggers";
import {
  IntervalTrigger,
  TriggerConfigurationError,
  TriggerStopTimeoutError,
} from "@workglow/triggers";
import type { ILogger } from "@workglow/util";
import { getLogger, setLogger } from "@workglow/util";
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

interface WarnRecord {
  readonly message: string;
  readonly meta: Record<string, unknown> | undefined;
}

/**
 * Installs a logger that records `warn` calls; returns the sink and a restore fn.
 * Built from scratch rather than spread from the installed logger, whose methods
 * live on a class prototype and would be lost.
 */
function captureWarnings(): { warnings: WarnRecord[]; restore: () => void } {
  const warnings: WarnRecord[] = [];
  const previous = getLogger();
  const noop = (): void => {};
  const logger: ILogger = {
    debug: noop,
    info: noop,
    warn: (message: string, meta?: Record<string, unknown>) => {
      warnings.push({ message, meta });
    },
    error: noop,
    fatal: noop,
    child: () => logger,
    time: noop,
    timeEnd: noop,
    group: noop,
    groupEnd: noop,
  };
  setLogger(logger);
  return { warnings, restore: () => setLogger(previous) };
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

  test("rejects a handler that is not a function", () => {
    const trigger = new IntervalTrigger({ intervalMs: PERIOD });
    expect(() => trigger.start(undefined as never)).toThrow(TriggerConfigurationError);
    // Nothing was touched: no timer, and the trigger is still startable.
    expect(trigger.running).toBe(false);
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

    test("maxConcurrentFires caps concurrent fan-out, degrading the excess to skips", async () => {
      // Without a cap, a handler slower than the period gains one more
      // invocation every tick, indefinitely — the fan-out is bounded only by
      // whatever the handler itself runs out of first.
      const trigger = new IntervalTrigger({
        intervalMs: PERIOD,
        overlap: "concurrent",
        maxConcurrentFires: 2,
      });
      const gate = createGate();
      const fired: number[] = [];
      const skipped: number[] = [];
      trigger.on("skip", (scheduledAt) => skipped.push(scheduledAt));

      trigger.start(async (context) => {
        fired.push(context.scheduledAt);
        await gate.promise;
      });

      await advanceFakeTimers(PERIOD * 4);
      expect(fired).toEqual([START + PERIOD, START + PERIOD * 2]);
      expect(skipped).toEqual([START + PERIOD * 3, START + PERIOD * 4]);

      // Once the in-flight invocations settle, the cap stops applying.
      gate.open();
      await flushAsyncWork();
      await advanceFakeTimers(PERIOD);
      expect(fired).toEqual([START + PERIOD, START + PERIOD * 2, START + PERIOD * 5]);

      await trigger.stop();
    });

    test("concurrent stays unbounded when no cap is given", async () => {
      const trigger = new IntervalTrigger({ intervalMs: PERIOD, overlap: "concurrent" });
      const gate = createGate();
      let fires = 0;
      const skipped: number[] = [];
      trigger.on("skip", (scheduledAt) => skipped.push(scheduledAt));

      trigger.start(async () => {
        fires += 1;
        await gate.promise;
      });

      await advanceFakeTimers(PERIOD * 6);
      expect(fires).toBe(6);
      expect(skipped).toEqual([]);

      gate.open();
      await flushAsyncWork();
      await trigger.stop();
    });

    test("rejects a non-positive concurrency bound", () => {
      expect(
        () =>
          new IntervalTrigger({ intervalMs: PERIOD, overlap: "concurrent", maxConcurrentFires: 0 })
      ).toThrow(TriggerConfigurationError);
      expect(
        () =>
          new IntervalTrigger({
            intervalMs: PERIOD,
            overlap: "concurrent",
            maxConcurrentFires: 1.5,
          })
      ).toThrow(TriggerConfigurationError);
    });
  });

  describe("skip logging", () => {
    test("a contiguous run of skips logs once, then a count when it ends", async () => {
      // A wedged handler at a 1s period would otherwise write 3,600 identical
      // warnings an hour, forever.
      const { warnings, restore } = captureWarnings();
      try {
        const trigger = new IntervalTrigger({ intervalMs: PERIOD });
        const gate = createGate();
        const skips: number[] = [];
        trigger.on("skip", (scheduledAt) => skips.push(scheduledAt));
        trigger.start(async () => {
          await gate.promise;
        });

        await advanceFakeTimers(PERIOD);
        await advanceFakeTimers(PERIOD * 4);

        // The EVENT still fires per dropped tick; only the log is collapsed.
        expect(skips).toHaveLength(4);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]?.message).toContain("skipped");

        gate.open();
        await flushAsyncWork();
        await advanceFakeTimers(PERIOD);

        expect(warnings).toHaveLength(2);
        expect(warnings[1]?.meta?.skipped).toBe(4);

        await trigger.stop();
      } finally {
        restore();
      }
    });

    test("an isolated skip logs once and adds no summary", async () => {
      // The ordinary intermittent case must not have its log volume doubled.
      const { warnings, restore } = captureWarnings();
      try {
        const trigger = new IntervalTrigger({ intervalMs: PERIOD });
        const gate = createGate();
        const skips: number[] = [];
        trigger.on("skip", (scheduledAt) => skips.push(scheduledAt));
        trigger.start(async () => {
          await gate.promise;
        });

        await advanceFakeTimers(PERIOD * 2);
        expect(skips).toHaveLength(1);

        gate.open();
        await flushAsyncWork();
        await advanceFakeTimers(PERIOD);

        expect(warnings).toHaveLength(1);

        await trigger.stop();
      } finally {
        restore();
      }
    });

    test("stopping mid-skip still reports the skip count", async () => {
      const { warnings, restore } = captureWarnings();
      try {
        const trigger = new IntervalTrigger({ intervalMs: PERIOD });
        const gate = createGate();
        const skips: number[] = [];
        trigger.on("skip", (scheduledAt) => skips.push(scheduledAt));
        trigger.start(async () => {
          await gate.promise;
        });

        await advanceFakeTimers(PERIOD * 4);
        expect(skips).toHaveLength(3);

        const stopping = trigger.stop();
        expect(warnings.map((warning) => warning.meta?.skipped)).toContain(3);

        gate.open();
        await stopping;
      } finally {
        restore();
      }
    });
  });

  test("a period past the host timer ceiling is served in chunks", async () => {
    // A delay over 2^31-1 ms overflows a host timer and fires IMMEDIATELY, so
    // an unchunked wait would turn a very long period into a hot loop.
    const maxTimerDelay = 2_147_483_647;
    const intervalMs = 2 ** 31 + PERIOD;
    const trigger = new IntervalTrigger({ intervalMs });
    const fires: number[] = [];
    trigger.start((context) => {
      fires.push(context.scheduledAt);
    });

    await advanceFakeTimers(maxTimerDelay);
    expect(fires).toEqual([]);

    await advanceFakeTimers(intervalMs - maxTimerDelay);
    expect(fires).toEqual([START + intervalMs]);

    await trigger.stop();
  });

  test("a backward clock step does not stall the loop", async () => {
    // A fixed-interval period is measured by the host timer, not by the wall
    // clock, so an NTP correction backwards must not turn one 60s period into a
    // 31-minute silence. Both assertions are load-bearing: re-arming the pending
    // tick alone would fire once and then go quiet for the size of the step,
    // because the next target is still computed off the pre-step anchor.
    const trigger = new IntervalTrigger({ intervalMs: 60_000 });
    let fires = 0;
    trigger.start(() => {
      fires += 1;
    });

    await advanceFakeTimers(30_000);
    // Sinon shifts every pending callAt by the same delta, so 30s of monotonic
    // delay remains on a timer whose target is now 30 minutes in the future.
    vi.setSystemTime(Date.now() - 1_800_000);
    await advanceFakeTimers(30_000);
    await advanceFakeTimers(0);
    expect(fires).toBe(1);

    await advanceFakeTimers(60_000);
    expect(fires).toBe(2);

    await trigger.stop();
  });

  test("a host timer that fires a hair early still waits for its instant", async () => {
    // Hosts do fire a timer a millisecond early. That shortfall is jitter, not a
    // clock step, so the tick is re-armed for the remainder rather than fired.
    const trigger = new IntervalTrigger({ intervalMs: PERIOD });
    let fires = 0;
    trigger.start(() => {
      fires += 1;
    });

    await advanceFakeTimers(PERIOD - 1);
    vi.setSystemTime(Date.now() - 1);
    await advanceFakeTimers(1);
    expect(fires).toBe(0);

    await advanceFakeTimers(1);
    expect(fires).toBe(1);

    await trigger.stop();
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

    test("a handler that rejects because stop() aborted it is not reported as an error", async () => {
      // The ordinary shape of a cooperative handler: forward the signal, reject
      // when it aborts. Reporting that on `error` makes every graceful shutdown
      // look like a failure and pushes callers into installing absorbing
      // `error` listeners, which then swallow the failures that do matter.
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });
      const errors: Error[] = [];
      trigger.on("error", (error) => errors.push(error));

      trigger.start(
        (context) =>
          new Promise<void>((_resolve, reject) => {
            context.signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true }
            );
          })
      );

      await advanceFakeTimers(PERIOD);
      await trigger.stop();

      expect(errors).toEqual([]);
      expect(trigger.running).toBe(false);
    });

    test("a handler that throws for its own reasons is still reported", async () => {
      // The guard above keys on the run's signal, so it must not blanket
      // everything: a real failure before any stop() is still a failure.
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });
      const errors: Error[] = [];
      trigger.on("error", (error) => errors.push(error));

      trigger.start(() => {
        throw new Error("sink down");
      });

      await advanceFakeTimers(PERIOD);
      expect(errors.map((error) => error.message)).toEqual(["sink down"]);

      await trigger.stop();
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

    test("a restart during stop() does not emit stop while the trigger is running", async () => {
      // An observer that sees `stop` while `running` is true concludes the
      // trigger is dead and stops watching it — while it is actively firing.
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });
      const gate = createGate();
      const runningAtStop: boolean[] = [];
      trigger.on("stop", () => runningAtStop.push(trigger.running));

      trigger.start(async () => {
        await gate.promise;
      });
      await advanceFakeTimers(PERIOD);

      // NOT awaited: the gated gen-1 handler keeps the old run draining.
      const stopping = trigger.stop();
      trigger.start(() => {});

      gate.open();
      await stopping;

      // Gen 1 drained, but gen 2 owns the trigger.
      expect(runningAtStop).toEqual([]);
      expect(trigger.running).toBe(true);

      // ...and the real stop still reports itself.
      await trigger.stop();
      expect(runningAtStop).toEqual([false]);
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

    test("stop() called from a fire listener still waits for the handler", async () => {
      // `trigger.once("fire", () => trigger.stop())` is the ordinary idiom for
      // "run once". The fire emit and the handler's synchronous head run inside
      // the tick chain, so a stop() begun there must still see that chain as
      // pending — otherwise it drains an empty set and resolves while the
      // handler is running, which is the opposite of what stop() promises.
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });
      const order: string[] = [];
      trigger.on("stop", () => order.push("stop-event"));

      let stopping: Promise<void> | undefined;
      trigger.once("fire", () => {
        stopping = trigger.stop();
      });
      trigger.start(async () => {
        order.push("handler-start");
        await new Promise<void>((resolve) => setTimeout(resolve, PERIOD / 2));
        order.push("handler-end");
      });

      await advanceFakeTimers(PERIOD);
      expect(order).toEqual(["handler-start"]);
      expect(stopping).toBeDefined();

      let stopResolved = false;
      void stopping!.then(() => {
        stopResolved = true;
      });
      await flushAsyncWork();
      expect(stopResolved).toBe(false);

      // Let the handler's own timer run out.
      await advanceFakeTimers(PERIOD);
      await stopping;

      expect(order).toEqual(["handler-start", "handler-end", "stop-event"]);
      expect(trigger.running).toBe(false);
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

  describe("stop deadline", () => {
    test("stop() is unbounded by default and waits for a handler that never settles", async () => {
      // The default MUST stay unbounded: it is what makes "await stop() means no
      // handler of that run is still running" true. A bounded default would turn
      // that documented guarantee into a lie for every caller that never asked.
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });
      const gate = createGate();
      trigger.start(async () => {
        await gate.promise;
      });

      await advanceFakeTimers(PERIOD);

      let resolved = false;
      const stopping = trigger.stop();
      void stopping.then(() => {
        resolved = true;
      });

      await advanceFakeTimers(PERIOD * 50);
      expect(resolved).toBe(false);

      gate.open();
      await stopping;
      expect(resolved).toBe(true);
    });

    test("stop({ timeoutMs }) abandons what is still in flight and reports the count", async () => {
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });
      const gate = createGate();
      const errors: Error[] = [];
      const stops: string[] = [];
      trigger.on("error", (error) => errors.push(error));
      trigger.on("stop", () => stops.push("stop"));
      trigger.start(async () => {
        await gate.promise;
      });

      await advanceFakeTimers(PERIOD);

      const stopping = trigger.stop({ timeoutMs: PERIOD * 5 });
      await advanceFakeTimers(PERIOD * 5);
      await stopping;

      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(TriggerStopTimeoutError);
      expect(errors[0]?.message).toContain("1 handler invocation(s)");
      // The `stop` event still fires: the run was released, not stranded.
      expect(stops).toEqual(["stop"]);
      expect(trigger.running).toBe(false);
      // The deadline timer was cleared rather than left to fire on a dead run.
      expect(vi.getTimerCount()).toBe(0);

      // A restart works, which is the point of running the release tail on the
      // timeout path: otherwise `_run` stays set and every start() is a no-op.
      let fires = 0;
      trigger.start(() => {
        fires += 1;
      });
      await advanceFakeTimers(PERIOD);
      expect(fires).toBe(1);

      gate.open();
      await trigger.stop();
    });

    test("stopTimeoutMs supplies the default deadline for a bare stop()", async () => {
      const trigger = new IntervalTrigger({ intervalMs: PERIOD, stopTimeoutMs: PERIOD * 3 });
      const gate = createGate();
      const errors: Error[] = [];
      trigger.on("error", (error) => errors.push(error));
      trigger.start(async () => {
        await gate.promise;
      });

      await advanceFakeTimers(PERIOD);

      const stopping = trigger.stop();
      await advanceFakeTimers(PERIOD * 3);
      await stopping;

      expect(errors[0]).toBeInstanceOf(TriggerStopTimeoutError);
      expect(trigger.running).toBe(false);

      gate.open();
      await flushAsyncWork();
    });

    test("a handler that settles inside the deadline reports nothing", async () => {
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });
      const gate = createGate();
      const errors: Error[] = [];
      let settled = false;
      trigger.on("error", (error) => errors.push(error));
      trigger.start(async () => {
        await gate.promise;
        settled = true;
      });

      await advanceFakeTimers(PERIOD);

      const stopping = trigger.stop({ timeoutMs: PERIOD * 5 });
      gate.open();
      await stopping;

      expect(settled).toBe(true);
      expect(errors).toEqual([]);
      // The deadline timer is cancelled once the drain wins the race.
      expect(vi.getTimerCount()).toBe(0);
    });

    test("rejects a non-positive stop deadline", () => {
      expect(() => new IntervalTrigger({ intervalMs: PERIOD, stopTimeoutMs: 0 })).toThrow(
        TriggerConfigurationError
      );
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });
      expect(() => trigger.stop({ timeoutMs: -1 })).toThrow(TriggerConfigurationError);
      expect(() => trigger.stop({ timeoutMs: 1.5 })).toThrow(TriggerConfigurationError);
    });
  });
});
