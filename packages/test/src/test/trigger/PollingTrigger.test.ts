/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  firesOnChange,
  isNonEmptyPollResult,
  PollingTrigger,
  TriggerConfigurationError,
  TriggerPollTimeoutError,
} from "@workglow/triggers";
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

describe("PollingTrigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("rejects invalid options", () => {
    expect(() => new PollingTrigger({ intervalMs: 0, poll: () => 1 })).toThrow(
      TriggerConfigurationError
    );
    expect(() => new PollingTrigger({ intervalMs: PERIOD, poll: undefined as never })).toThrow(
      TriggerConfigurationError
    );
  });

  describe("isNonEmptyPollResult", () => {
    test.each([
      [undefined, false],
      [null, false],
      [[], false],
      ["", false],
      [[1], true],
      ["x", true],
      [0, true],
      [false, true],
      [{}, true],
    ])("%o -> %s", (value, expected) => {
      expect(isNonEmptyPollResult(value)).toBe(expected);
    });
  });

  test("fires only on a non-empty result, and never on an empty one", async () => {
    const results: unknown[] = [[], [], ["a"], [], ["b", "c"]];
    let polls = 0;
    const trigger = new PollingTrigger<unknown>({
      intervalMs: PERIOD,
      poll: () => results[polls++],
    });

    const payloads: unknown[] = [];
    trigger.start((context) => {
      payloads.push(context.payload);
    });

    await advanceFakeTimers(PERIOD * 5);

    expect(polls).toBe(5);
    // Five polls, two interesting results — that conditional fire is the whole
    // difference from an IntervalTrigger.
    expect(payloads).toEqual([["a"], ["b", "c"]]);

    await trigger.stop();
  });

  test("hands the poll result to the handler as the payload", async () => {
    const trigger = new PollingTrigger({
      intervalMs: PERIOD,
      poll: () => ({ id: 7 }),
    });
    const payloads: unknown[] = [];
    trigger.start((context) => {
      payloads.push(context.payload);
    });

    await advanceFakeTimers(PERIOD);
    expect(payloads).toEqual([{ id: 7 }]);
    expect(trigger.lastResult).toEqual({ id: 7 });

    await trigger.stop();
  });

  test("firesOnChange only fires when the result differs from the previous one", async () => {
    const results = ["a", "a", "b", "b", "c"];
    let polls = 0;
    const trigger = new PollingTrigger<string>({
      intervalMs: PERIOD,
      poll: () => results[polls++]!,
      shouldFire: firesOnChange,
    });

    const payloads: string[] = [];
    trigger.start((context) => {
      payloads.push(context.payload as string);
    });

    await advanceFakeTimers(PERIOD * 5);
    expect(payloads).toEqual(["a", "b", "c"]);

    await trigger.stop();
  });

  test("a custom predicate sees both the current and the previous result", async () => {
    const values = [1, 5, 2, 9];
    let polls = 0;
    const seen: Array<[number, number | undefined]> = [];
    const trigger = new PollingTrigger<number>({
      intervalMs: PERIOD,
      poll: () => values[polls++]!,
      shouldFire: (result, previous) => {
        seen.push([result, previous]);
        return previous !== undefined && result > previous;
      },
    });

    const payloads: number[] = [];
    trigger.start((context) => {
      payloads.push(context.payload as number);
    });

    await advanceFakeTimers(PERIOD * 4);

    expect(seen).toEqual([
      [1, undefined],
      [5, 1],
      [2, 5],
      [9, 2],
    ]);
    expect(payloads).toEqual([5, 9]);

    await trigger.stop();
  });

  test("a throwing poll fn does not kill the loop and emits the error", async () => {
    let polls = 0;
    const trigger = new PollingTrigger<string>({
      intervalMs: PERIOD,
      poll: () => {
        polls += 1;
        if (polls === 2) throw new RangeError("poll exploded");
        return `value-${polls}`;
      },
    });

    const errors: Error[] = [];
    const payloads: unknown[] = [];
    trigger.on("error", (error) => errors.push(error));
    trigger.start((context) => {
      payloads.push(context.payload);
    });

    await advanceFakeTimers(PERIOD * 3);

    expect(polls).toBe(3);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RangeError);
    expect(errors[0]?.message).toBe("poll exploded");
    // The loop kept polling after the failure.
    expect(payloads).toEqual(["value-1", "value-3"]);
    expect(trigger.running).toBe(true);

    await trigger.stop();
  });

  test("a failed poll leaves the previous result untouched", async () => {
    let polls = 0;
    const trigger = new PollingTrigger<string>({
      intervalMs: PERIOD,
      poll: () => {
        polls += 1;
        if (polls === 2) throw new Error("nope");
        return "steady";
      },
      shouldFire: firesOnChange,
    });
    trigger.on("error", () => {});

    const payloads: unknown[] = [];
    trigger.start((context) => {
      payloads.push(context.payload);
    });

    await advanceFakeTimers(PERIOD * 3);

    // Poll 3 returns the same value poll 1 did, so change detection stays quiet.
    expect(payloads).toEqual(["steady"]);
    expect(trigger.lastResult).toBe("steady");

    await trigger.stop();
  });

  test("a failed handler does not consume the change", async () => {
    // At-most-once here is silent data loss: the update the handler failed on is
    // never offered again, because the baseline already moved past it.
    const results = ["a", "b", "b", "b"];
    let polls = 0;
    let failNext = true;
    const trigger = new PollingTrigger<string>({
      intervalMs: PERIOD,
      poll: () => results[polls++]!,
      shouldFire: firesOnChange,
    });
    const errors: Error[] = [];
    trigger.on("error", (error) => errors.push(error));

    const payloads: string[] = [];
    trigger.start((context) => {
      payloads.push(context.payload as string);
      if (context.payload === "b" && failNext) {
        failNext = false;
        throw new Error("sink down");
      }
    });

    await advanceFakeTimers(PERIOD * 4);

    // "b" is re-delivered on the next poll that still observes it, then settles.
    expect(payloads).toEqual(["a", "b", "b"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("sink down");
    expect(trigger.lastResult).toBe("b");

    await trigger.stop();
  });

  test("a failed handler does not resurrect a value a later tick already delivered", async () => {
    // Under `concurrent`, a slow failing tick settles AFTER a newer one advanced
    // the baseline. Restoring unconditionally would re-deliver a value that has
    // already been handled successfully.
    const results = ["a", "b", "c", "c"];
    let polls = 0;
    const gate = createGate();
    const trigger = new PollingTrigger<string>({
      intervalMs: PERIOD,
      overlap: "concurrent",
      poll: () => results[polls++]!,
      shouldFire: firesOnChange,
    });
    trigger.on("error", () => {});

    const payloads: string[] = [];
    trigger.start(async (context) => {
      payloads.push(context.payload as string);
      if (context.payload === "b") {
        await gate.promise;
        throw new Error("sink down");
      }
    });

    await advanceFakeTimers(PERIOD * 3);
    expect(payloads).toEqual(["a", "b", "c"]);

    gate.open();
    await flushAsyncWork();
    await advanceFakeTimers(PERIOD);

    expect(payloads).toEqual(["a", "b", "c"]);
    expect(trigger.lastResult).toBe("c");

    await trigger.stop();
  });

  test("passes the trigger's abort signal to the poll function", async () => {
    const signals: AbortSignal[] = [];
    const trigger = new PollingTrigger<number>({
      intervalMs: PERIOD,
      poll: (signal) => {
        signals.push(signal);
        return 1;
      },
    });
    trigger.start(() => {});

    await advanceFakeTimers(PERIOD);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    await trigger.stop();
    expect(signals[0]?.aborted).toBe(true);
  });

  test("a restart resets the change-detection baseline", async () => {
    // The baseline belongs to a RUN. Carrying it across a stop/start would make
    // the first poll of the new run look unchanged and swallow the very value
    // the restarted trigger was meant to report.
    let polls = 0;
    const trigger = new PollingTrigger<string>({
      intervalMs: PERIOD,
      poll: () => {
        polls += 1;
        return "steady";
      },
      shouldFire: firesOnChange,
    });

    const payloads: unknown[] = [];
    const handler = (context: { payload: unknown }): void => {
      payloads.push(context.payload);
    };

    trigger.start(handler);
    await advanceFakeTimers(PERIOD * 2);
    expect(payloads).toEqual(["steady"]);
    await trigger.stop();

    trigger.start(handler);
    await advanceFakeTimers(PERIOD);
    expect(payloads).toEqual(["steady", "steady"]);
    expect(polls).toBe(3);

    await trigger.stop();
  });

  test("a restart while stop() is still draining also resets the baseline", async () => {
    // The awaited restart above is the easy half. A stop() that is NOT awaited
    // hands the trigger to the new run while the old one is still draining, and
    // per-run state that lives on the trigger would carry the old baseline into
    // it — leaving a firesOnChange poller that never fires again.
    let polls = 0;
    const gate = createGate();
    const trigger = new PollingTrigger<string>({
      intervalMs: PERIOD,
      poll: () => {
        polls += 1;
        return "steady";
      },
      shouldFire: firesOnChange,
    });

    const firstPayloads: unknown[] = [];
    trigger.start(async (context) => {
      firstPayloads.push(context.payload);
      await gate.promise;
    });

    await advanceFakeTimers(PERIOD);
    expect(firstPayloads).toEqual(["steady"]);
    expect(trigger.lastResult).toBe("steady");

    // NOT awaited: the gated handler keeps the old run draining.
    const stopping = trigger.stop();
    const secondPayloads: unknown[] = [];
    trigger.start((context) => {
      secondPayloads.push(context.payload);
    });

    expect(trigger.lastResult).toBeUndefined();
    expect(trigger.consecutiveFailures).toBe(0);

    await advanceFakeTimers(PERIOD);
    expect(secondPayloads).toEqual(["steady"]);
    expect(polls).toBe(2);

    gate.open();
    await stopping;
    await trigger.stop();
  });

  describe("errorBackoff", () => {
    test("rejects an invalid backoff", () => {
      expect(
        () =>
          new PollingTrigger({
            intervalMs: PERIOD,
            poll: () => 1,
            errorBackoff: { initialMs: 0, maxMs: 100 },
          })
      ).toThrow(TriggerConfigurationError);
      expect(
        () =>
          new PollingTrigger({
            intervalMs: PERIOD,
            poll: () => 1,
            errorBackoff: { initialMs: 200, maxMs: 100 },
          })
      ).toThrow(TriggerConfigurationError);
    });

    test("slows the loop down while the poll keeps failing, and recovers", async () => {
      let polls = 0;
      let failing = true;
      const trigger = new PollingTrigger<number>({
        intervalMs: PERIOD,
        poll: () => {
          polls += 1;
          if (failing) throw new Error("dependency down");
          return polls;
        },
        errorBackoff: { initialMs: PERIOD * 2, maxMs: PERIOD * 8 },
      });
      trigger.on("error", () => {});
      trigger.start(() => {});

      // Full-rate ticks at P and 2P (the tick after a failure is already
      // scheduled), then backoff: 2P, 4P, 8P, 8P...
      await advanceFakeTimers(PERIOD * 2);
      expect(polls).toBe(2);
      expect(trigger.consecutiveFailures).toBe(2);

      await advanceFakeTimers(PERIOD * 2);
      expect(polls).toBe(3);

      // Without backoff the same window would have added 10 more polls.
      await advanceFakeTimers(PERIOD * 10);
      expect(polls).toBeLessThan(7);

      failing = false;
      await advanceFakeTimers(PERIOD * 8);
      expect(trigger.consecutiveFailures).toBe(0);

      // One backed-off gap is still outstanding (the tick after the recovering
      // poll was scheduled before it succeeded); after that, full rate resumes.
      const recovered = polls;
      await advanceFakeTimers(PERIOD * 4);
      expect(polls).toBeGreaterThanOrEqual(recovered + 3);

      await trigger.stop();
    });

    test("a host that slept through a backed-off gap does not replay the backlog", async () => {
      // The backed-off target is measured from the previous tick's instant, so a
      // host suspended across several gaps leaves it far in the past. Unclamped,
      // every one of those stale targets is already due and the loop replays the
      // whole backlog as a burst of setTimeout(0) ticks.
      let polls = 0;
      const trigger = new PollingTrigger<number>({
        intervalMs: PERIOD,
        poll: () => {
          polls += 1;
          throw new Error("dependency down");
        },
        errorBackoff: { initialMs: PERIOD * 2, maxMs: PERIOD * 2 },
      });
      trigger.on("error", () => {});
      let skips = 0;
      trigger.on("skip", () => {
        skips += 1;
      });
      trigger.start(() => {});

      // Ticks at P and 2P; the tick after those is armed for START + 4P.
      await advanceFakeTimers(PERIOD * 2);
      expect(polls).toBe(2);

      // The host freezes for 10s. Sinon shifts every pending callAt by the same
      // delta, so the timer keeps its 200ms of MONOTONIC delay while the wall
      // clock jumps 10s past the target it was armed for.
      vi.setSystemTime(START + PERIOD * 2 + 10_000);
      await advanceFakeTimers(PERIOD * 2);
      // A replayed backlog arrives as zero-delay ticks, which fake timers space a
      // millisecond apart, so give it a whole period to show itself. The clamped
      // loop has nothing due until START + 10_600.
      await advanceFakeTimers(PERIOD);

      expect(polls).toBe(3);
      expect(skips).toBe(0);

      await trigger.stop();
    });
  });

  describe("pollTimeoutMs", () => {
    // Deliberately not a multiple of PERIOD, so a deadline lands between ticks
    // and the assertions do not depend on same-instant timer ordering.
    const POLL_TIMEOUT = 250;

    test("rejects an invalid pollTimeoutMs", () => {
      expect(
        () => new PollingTrigger({ intervalMs: PERIOD, poll: () => 1, pollTimeoutMs: 0 })
      ).toThrow(TriggerConfigurationError);
      expect(
        () => new PollingTrigger({ intervalMs: PERIOD, poll: () => 1, pollTimeoutMs: 1.5 })
      ).toThrow(TriggerConfigurationError);
    });

    test("a hung poll wedges the trigger when no timeout is configured", async () => {
      // The default is unchanged, deliberately: a deadline nobody asked for
      // would break a legitimately slow poll on upgrade. A hang is not a throw,
      // so nothing reaches `error` and every later tick is dropped instead.
      const trigger = new PollingTrigger<string>({
        intervalMs: PERIOD,
        poll: () => new Promise<string>(() => {}),
      });
      const errors: Error[] = [];
      const payloads: unknown[] = [];
      let skips = 0;
      trigger.on("error", (error) => errors.push(error));
      trigger.on("skip", () => {
        skips += 1;
      });
      trigger.start((context) => {
        payloads.push(context.payload);
      });

      await advanceFakeTimers(PERIOD * 5);

      expect(errors).toEqual([]);
      expect(skips).toBe(4);
      expect(payloads).toEqual([]);
      expect(trigger.running).toBe(true);

      // Not stopped: `stop()` awaits the in-flight tick, and that tick is the
      // pending poll — the same wedge, seen from the other side.
    });

    test("pollTimeoutMs fails a hung poll and the loop keeps going", async () => {
      let polls = 0;
      const trigger = new PollingTrigger<string>({
        intervalMs: PERIOD,
        pollTimeoutMs: POLL_TIMEOUT,
        poll: () => {
          polls += 1;
          if (polls === 1) return new Promise<string>(() => {});
          return "ok";
        },
      });
      const errors: Error[] = [];
      trigger.on("error", (error) => errors.push(error));
      const payloads: unknown[] = [];
      trigger.start((context) => {
        payloads.push(context.payload);
      });

      // Poll 1 starts at START + PERIOD; its deadline is START + 350.
      await advanceFakeTimers(PERIOD * 3);
      expect(errors).toEqual([]);
      expect(payloads).toEqual([]);

      // 350 -> the deadline fires; 400 -> the next tick polls a healthy source.
      await advanceFakeTimers(PERIOD);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(TriggerPollTimeoutError);
      expect(payloads).toEqual(["ok"]);
      expect(trigger.running).toBe(true);

      await trigger.stop();
    });

    test("the deadline aborts the signal handed to the poll", async () => {
      let observed: AbortSignal | undefined;
      const trigger = new PollingTrigger<string>({
        intervalMs: PERIOD,
        pollTimeoutMs: POLL_TIMEOUT,
        poll: (signal) => {
          observed ??= signal;
          return new Promise<string>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("poll aborted")), {
              once: true,
            });
          });
        },
      });
      const errors: Error[] = [];
      trigger.on("error", (error) => errors.push(error));
      trigger.start(() => {});

      await advanceFakeTimers(PERIOD * 4);

      expect(observed?.aborted).toBe(true);
      expect(observed?.reason).toBeInstanceOf(TriggerPollTimeoutError);
      // The tick fails with the TIMEOUT, not with the poll's own abort error:
      // a cooperative poll rejects synchronously on abort and would otherwise
      // win the race with its own error, hiding why the tick failed.
      expect(errors[0]).toBeInstanceOf(TriggerPollTimeoutError);

      await trigger.stop();
    });

    test("stop() aborts an in-flight poll's signal when a timeout is configured", async () => {
      let observed: AbortSignal | undefined;
      const trigger = new PollingTrigger<string>({
        intervalMs: PERIOD,
        pollTimeoutMs: PERIOD * 10,
        poll: (signal) => {
          observed ??= signal;
          return new Promise<string>((_resolve, reject) => {
            // An AbortError, not a plain one: quieting a stopped tick keys on
            // the error's SHAPE as well as the run's state, so that a genuine
            // failure during shutdown — a flush or a commit, the work most
            // likely to fail there — is still reported rather than filed at
            // debug alongside the cancellations. This is the convention the
            // rest of the repo already constructs.
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("poll aborted", "AbortError")),
              { once: true }
            );
          });
        },
      });
      // A COLLECTING listener, not an absorbing one. The poll rejects because
      // stop() aborted it, which is the graceful path — reporting it on `error`
      // makes every orderly shutdown look like a failure, and the absorbing
      // listener this test used to need was the evidence.
      const errors: Error[] = [];
      trigger.on("error", (error) => errors.push(error));
      trigger.start(() => {});

      await advanceFakeTimers(PERIOD);
      expect(observed?.aborted).toBe(false);

      const stopping = trigger.stop();
      // Synchronous, through the run controller the per-poll controller follows.
      expect(observed?.aborted).toBe(true);

      await stopping;
      expect(trigger.running).toBe(false);
      expect(errors).toEqual([]);
      // The deadline timer was cleared rather than left to fire on a dead run.
      expect(vi.getTimerCount()).toBe(0);
    });

    test("a timed-out poll drives errorBackoff", async () => {
      let polls = 0;
      const trigger = new PollingTrigger<string>({
        intervalMs: PERIOD,
        pollTimeoutMs: POLL_TIMEOUT,
        errorBackoff: { initialMs: PERIOD * 4, maxMs: PERIOD * 4 },
        poll: () => {
          polls += 1;
          return new Promise<string>(() => {});
        },
      });
      trigger.on("error", () => {});
      trigger.start(() => {});

      // The first deadline fires at START + 350: a timeout is a POLL failure.
      await advanceFakeTimers(PERIOD * 4);
      expect(trigger.consecutiveFailures).toBeGreaterThanOrEqual(1);

      const polled = polls;
      await advanceFakeTimers(PERIOD * 20);
      // At the full rate that window is 20 polls; backed off it is a handful.
      expect(polls - polled).toBeLessThan(10);

      // This poll ignores its signal, so its DEADLINE is what releases the
      // drain — which is also how a timeout bounds `stop()` on a hung poll.
      const stopping = trigger.stop();
      await advanceFakeTimers(POLL_TIMEOUT);
      await stopping;
      expect(trigger.running).toBe(false);
    });
  });

  test("stop() halts polling", async () => {
    let polls = 0;
    const trigger = new PollingTrigger<number>({
      intervalMs: PERIOD,
      poll: () => {
        polls += 1;
        return polls;
      },
    });
    trigger.start(() => {});

    await advanceFakeTimers(PERIOD * 2);
    expect(polls).toBe(2);

    await trigger.stop();
    await advanceFakeTimers(PERIOD * 5);
    expect(polls).toBe(2);
  });
});
