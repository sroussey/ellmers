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
} from "@workglow/triggers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { advanceFakeTimers } from "../helpers/advanceFakeTimers";

const START = Date.UTC(2026, 0, 1, 0, 0, 0);
const PERIOD = 100;

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
