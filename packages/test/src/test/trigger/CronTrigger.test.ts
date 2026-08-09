/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CronExpressionError, CronTrigger, CronUnsatisfiableError } from "@workglow/triggers";
import { afterEach, describe, expect, test, vi } from "vitest";

import { advanceFakeTimers, flushAsyncWork } from "../helpers/advanceFakeTimers";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * `CronTrigger` reads the wall clock to compute its next fire, so the system
 * time and the timer queue must be faked together — advancing timers alone
 * would leave `Date.now()` behind and every computed delay would be wrong.
 */
function useFakeClock(at: number): void {
  vi.useFakeTimers();
  vi.setSystemTime(at);
}

const isoFires = (fires: number[]): string[] => fires.map((ms) => new Date(ms).toISOString());

describe("CronTrigger", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("rejects an invalid expression at construction, not at the first tick", () => {
    expect(() => new CronTrigger({ expression: "not a cron" })).toThrow(CronExpressionError);
    expect(() => new CronTrigger({ expression: "@hourly" })).toThrow(CronExpressionError);
  });

  test("exposes the normalized expression and the cron kind", () => {
    const trigger = new CronTrigger({ expression: "  */5   * * * *  " });
    expect(trigger.expression).toBe("*/5 * * * *");
    expect(trigger.kind).toBe("cron");
  });

  test("fires on every matching minute boundary", async () => {
    useFakeClock(Date.UTC(2026, 2, 10, 12, 0, 0));
    const trigger = new CronTrigger({ expression: "*/5 * * * *" });
    const fires: number[] = [];
    trigger.start((context) => {
      fires.push(context.scheduledAt);
      expect(Date.now()).toBe(context.scheduledAt);
    });

    await advanceFakeTimers(15 * MINUTE);

    expect(isoFires(fires)).toEqual([
      "2026-03-10T12:05:00.000Z",
      "2026-03-10T12:10:00.000Z",
      "2026-03-10T12:15:00.000Z",
    ]);

    await trigger.stop();
  });

  test("does not fire before the first matching instant", async () => {
    useFakeClock(Date.UTC(2026, 2, 10, 12, 0, 0));
    const trigger = new CronTrigger({ expression: "*/5 * * * *" });
    const fires: number[] = [];
    trigger.start((context) => {
      fires.push(context.scheduledAt);
    });

    await advanceFakeTimers(5 * MINUTE - 1);
    expect(fires).toEqual([]);

    await advanceFakeTimers(1);
    expect(fires).toHaveLength(1);

    await trigger.stop();
  });

  test("starting exactly on a boundary waits for the NEXT one", async () => {
    useFakeClock(Date.UTC(2026, 2, 10, 12, 0, 0));
    const trigger = new CronTrigger({ expression: "0 * * * *" });
    const fires: number[] = [];
    trigger.start((context) => {
      fires.push(context.scheduledAt);
    });

    await advanceFakeTimers(HOUR - 1);
    expect(fires).toEqual([]);

    await advanceFakeTimers(1);
    expect(isoFires(fires)).toEqual(["2026-03-10T13:00:00.000Z"]);

    await trigger.stop();
  });

  test("does not drift over 100 minute boundaries", async () => {
    const start = Date.UTC(2026, 2, 10, 12, 0, 0);
    useFakeClock(start);
    const trigger = new CronTrigger({ expression: "* * * * *" });
    const fires: number[] = [];
    trigger.start((context) => {
      fires.push(context.scheduledAt);
    });

    await advanceFakeTimers(100 * MINUTE);

    expect(fires).toHaveLength(100);
    expect(fires).toEqual(Array.from({ length: 100 }, (_, i) => start + (i + 1) * MINUTE));

    await trigger.stop();
  });

  test("skips weekends for a weekday schedule", async () => {
    // Friday 2026-03-13, one hour before the 09:00 UTC fire.
    useFakeClock(Date.UTC(2026, 2, 13, 8, 0, 0));
    const trigger = new CronTrigger({ expression: "0 9 * * 1-5" });
    const fires: number[] = [];
    trigger.start((context) => {
      fires.push(context.scheduledAt);
    });

    // Through Tuesday morning: Friday fires, Saturday and Sunday are skipped
    // entirely, then Monday and Tuesday fire.
    await advanceFakeTimers(4 * DAY + 2 * HOUR);

    expect(isoFires(fires)).toEqual([
      "2026-03-13T09:00:00.000Z",
      "2026-03-16T09:00:00.000Z",
      "2026-03-17T09:00:00.000Z",
    ]);

    await trigger.stop();
  });

  test("a wait longer than the host timer ceiling still fires once, at the right time", async () => {
    // A monthly schedule is ~31 days out — past the ~24.8-day setTimeout limit,
    // where an unchunked delay would overflow and fire immediately.
    useFakeClock(Date.UTC(2026, 0, 1, 0, 0, 1));
    const trigger = new CronTrigger({ expression: "0 0 1 * *" });
    const fires: number[] = [];
    trigger.start((context) => {
      fires.push(context.scheduledAt);
    });

    await advanceFakeTimers(25 * DAY);
    expect(fires).toEqual([]);

    await advanceFakeTimers(7 * DAY);
    expect(isoFires(fires)).toEqual(["2026-02-01T00:00:00.000Z"]);

    await trigger.stop();
  });

  test("a backward clock step delays a cron fire rather than misfiring it", async () => {
    // A cron expression names a calendar instant, so a clock corrected backwards
    // means the appointment has NOT arrived yet and the trigger must wait the
    // correction out. This is the guard that the interval triggers' "an expiry
    // is a fire whatever the clock reads" rule is never applied here too.
    useFakeClock(Date.UTC(2026, 2, 10, 12, 0, 0));
    const trigger = new CronTrigger({ expression: "*/5 * * * *" });
    let fires = 0;
    trigger.start(() => {
      fires += 1;
    });

    await advanceFakeTimers(2 * MINUTE);
    // Clock steps back 10 minutes; 3 minutes of monotonic delay remain.
    vi.setSystemTime(Date.now() - 10 * MINUTE);
    await advanceFakeTimers(3 * MINUTE);
    await advanceFakeTimers(0);
    expect(fires).toBe(0);

    // The clock reaches 12:05 for real.
    await advanceFakeTimers(10 * MINUTE);
    expect(fires).toBe(1);

    await trigger.stop();
  });

  test("stop() halts further fires", async () => {
    useFakeClock(Date.UTC(2026, 2, 10, 12, 0, 0));
    const trigger = new CronTrigger({ expression: "* * * * *" });
    let fires = 0;
    trigger.start(() => {
      fires += 1;
    });

    await advanceFakeTimers(2 * MINUTE);
    expect(fires).toBe(2);

    await trigger.stop();
    await advanceFakeTimers(10 * MINUTE);
    expect(fires).toBe(2);
  });

  test("a second start() is a no-op", async () => {
    useFakeClock(Date.UTC(2026, 2, 10, 12, 0, 0));
    const trigger = new CronTrigger({ expression: "* * * * *" });
    let fires = 0;
    const handler = (): void => {
      fires += 1;
    };
    trigger.start(handler);
    trigger.start(handler);

    await advanceFakeTimers(3 * MINUTE);
    expect(fires).toBe(3);

    await trigger.stop();
  });

  test("a start() that cannot compute a first fire leaves the trigger stopped", async () => {
    // `0 0 30 2 *` parses fine — February simply never has a 30th — so the
    // failure surfaces on the FIRST schedule, which is where `start()` must
    // leave the trigger untouched rather than half-live.
    useFakeClock(Date.UTC(2026, 2, 10, 12, 0, 0));
    const trigger = new CronTrigger({ expression: "0 0 30 2 *" });
    let fires = 0;
    const handler = (): void => {
      fires += 1;
    };

    expect(() => trigger.start(handler)).toThrow(CronUnsatisfiableError);
    expect(trigger.running).toBe(false);
    // A trigger left reporting `running` would swallow every later start() as a
    // no-op; this one must still report the real failure.
    expect(() => trigger.start(handler)).toThrow(CronUnsatisfiableError);

    await advanceFakeTimers(DAY);
    expect(fires).toBe(0);

    // A valid trigger started afterwards schedules normally.
    const healthy = new CronTrigger({ expression: "* * * * *" });
    let healthyFires = 0;
    healthy.start(() => {
      healthyFires += 1;
    });
    await advanceFakeTimers(2 * MINUTE);
    expect(healthyFires).toBe(2);

    await healthy.stop();
    await trigger.stop();
  });

  test("a handler rejection does not stop the schedule", async () => {
    useFakeClock(Date.UTC(2026, 2, 10, 12, 0, 0));
    const trigger = new CronTrigger({ expression: "* * * * *" });
    const errors: Error[] = [];
    trigger.on("error", (error) => errors.push(error));
    let fires = 0;
    trigger.start(async () => {
      fires += 1;
      throw new Error("handler failed");
    });

    await advanceFakeTimers(3 * MINUTE);
    await flushAsyncWork();

    expect(fires).toBe(3);
    expect(errors).toHaveLength(3);
    expect(trigger.running).toBe(true);

    await trigger.stop();
  });
});
