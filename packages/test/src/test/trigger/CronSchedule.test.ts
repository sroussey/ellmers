/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CronExpressionError,
  CronUnsatisfiableError,
  nextCronFireTime,
  parseCronExpression,
  TriggerError,
} from "@workglow/triggers";
import { describe, expect, test } from "vitest";

const iso = (ms: number): string => new Date(ms).toISOString();
const at = (text: string): number => Date.parse(text);

describe("parseCronExpression", () => {
  test("expands every supported field form", () => {
    const schedule = parseCronExpression("15,45 0-6/2 1,15 */3 1-5");
    expect([...schedule.minutes]).toEqual([15, 45]);
    expect([...schedule.hours]).toEqual([0, 2, 4, 6]);
    expect([...schedule.daysOfMonth]).toEqual([1, 15]);
    expect([...schedule.months]).toEqual([1, 4, 7, 10]);
    expect([...schedule.daysOfWeek]).toEqual([1, 2, 3, 4, 5]);
  });

  test("normalizes whitespace and reports the normalized expression", () => {
    expect(parseCronExpression("  0   9 * *  1  ").expression).toBe("0 9 * * 1");
  });

  test("treats day-of-week 7 as Sunday", () => {
    expect([...parseCronExpression("0 0 * * 7").daysOfWeek]).toEqual([0]);
    expect([...parseCronExpression("0 0 * * 0,7").daysOfWeek]).toEqual([0]);
  });

  test("tracks which day fields are restricted", () => {
    const unrestricted = parseCronExpression("0 0 * * *");
    expect(unrestricted.dayOfMonthRestricted).toBe(false);
    expect(unrestricted.dayOfWeekRestricted).toBe(false);

    const both = parseCronExpression("0 0 1 * 1");
    expect(both.dayOfMonthRestricted).toBe(true);
    expect(both.dayOfWeekRestricted).toBe(true);
  });

  describe.each([
    ["empty", "   "],
    ["four fields", "0 9 * *"],
    ["six fields (seconds)", "0 0 9 * * *"],
    ["macro", "@daily"],
    ["month name", "0 0 1 JAN *"],
    ["day name", "0 0 * * MON"],
    ["minute out of range", "60 * * * *"],
    ["hour out of range", "0 24 * * *"],
    ["day-of-month out of range", "0 0 32 * *"],
    ["month out of range", "0 0 1 13 *"],
    ["day-of-week out of range", "0 0 * * 8"],
    ["inverted range", "0 10-5 * * *"],
    ["zero step", "*/0 * * * *"],
    ["negative step", "*/-1 * * * *"],
    ["double step", "*/2/2 * * * *"],
    ["open-ended step", "5/10 * * * *"],
    ["empty list entry", "0,,5 * * * *"],
    ["Quartz L", "0 0 L * *"],
    ["Quartz W", "0 0 15W * *"],
    ["Quartz #", "0 0 * * 5#3"],
    ["Quartz ?", "0 0 ? * *"],
  ])("rejects %s", (_label, expression) => {
    test(`"${expression}" throws a typed error`, () => {
      expect(() => parseCronExpression(expression)).toThrow(CronExpressionError);
      // Every package error is a TriggerError, and every TriggerError is an Error.
      expect(() => parseCronExpression(expression)).toThrow(TriggerError);
      expect(() => parseCronExpression(expression)).toThrow(Error);
    });
  });
});

describe("nextCronFireTime", () => {
  // 2026-03-10T12:34:56Z is a Tuesday.
  const anchor = at("2026-03-10T12:34:56.000Z");

  test.each([
    ["* * * * *", anchor, "2026-03-10T12:35:00.000Z"],
    ["*/5 * * * *", anchor, "2026-03-10T12:35:00.000Z"],
    ["*/5 * * * *", at("2026-03-10T12:35:00.000Z"), "2026-03-10T12:40:00.000Z"],
    ["0 9 * * 1-5", anchor, "2026-03-11T09:00:00.000Z"],
    ["0 9 * * 1-5", at("2026-03-13T10:00:00.000Z"), "2026-03-16T09:00:00.000Z"],
    ["0 0 1 * *", anchor, "2026-04-01T00:00:00.000Z"],
    ["15,45 * * * *", anchor, "2026-03-10T12:45:00.000Z"],
    ["15,45 * * * *", at("2026-03-10T12:45:00.000Z"), "2026-03-10T13:15:00.000Z"],
    ["0-30/10 * * * *", anchor, "2026-03-10T13:00:00.000Z"],
    ["0-30/10 * * * *", at("2026-03-10T13:00:00.000Z"), "2026-03-10T13:10:00.000Z"],
    ["0-30/10 * * * *", at("2026-03-10T13:30:00.000Z"), "2026-03-10T14:00:00.000Z"],
  ])("%s after %s -> %s", (expression, from, expected) => {
    expect(iso(nextCronFireTime(parseCronExpression(expression), from))).toBe(expected);
  });

  test("a time exactly on a boundary returns the NEXT match, not the same one", () => {
    const schedule = parseCronExpression("0 0 * * *");
    const midnight = at("2026-03-10T00:00:00.000Z");
    expect(iso(nextCronFireTime(schedule, midnight))).toBe("2026-03-11T00:00:00.000Z");
  });

  test("sub-minute remainders do not skip the upcoming minute", () => {
    const schedule = parseCronExpression("* * * * *");
    expect(iso(nextCronFireTime(schedule, at("2026-03-10T00:00:00.001Z")))).toBe(
      "2026-03-10T00:01:00.000Z"
    );
  });

  test("rolls over month and year boundaries", () => {
    const schedule = parseCronExpression("0 0 1 * *");
    expect(iso(nextCronFireTime(schedule, at("2026-12-15T00:00:00.000Z")))).toBe(
      "2027-01-01T00:00:00.000Z"
    );
    expect(
      iso(nextCronFireTime(parseCronExpression("30 23 31 12 *"), at("2026-01-01T00:00:00.000Z")))
    ).toBe("2026-12-31T23:30:00.000Z");
  });

  test("finds the next leap day", () => {
    const schedule = parseCronExpression("0 0 29 2 *");
    expect(iso(nextCronFireTime(schedule, at("2026-03-01T00:00:00.000Z")))).toBe(
      "2028-02-29T00:00:00.000Z"
    );
    expect(iso(nextCronFireTime(schedule, at("2028-02-29T00:00:00.000Z")))).toBe(
      "2032-02-29T00:00:00.000Z"
    );
  });

  test("skips the 31st in months that do not have one", () => {
    const schedule = parseCronExpression("0 0 31 * *");
    expect(iso(nextCronFireTime(schedule, at("2026-01-31T00:00:00.000Z")))).toBe(
      "2026-03-31T00:00:00.000Z"
    );
  });

  test("finds a leap day across a century non-leap year", () => {
    // 2100 is divisible by 100 but not 400, so it is NOT a leap year: the gap
    // from 2096-02-29 to 2104-02-29 is just under eight years, longer than a
    // five-year search horizon would reach.
    const schedule = parseCronExpression("0 0 29 2 *");
    expect(iso(nextCronFireTime(schedule, at("2097-03-01T00:00:00.000Z")))).toBe(
      "2104-02-29T00:00:00.000Z"
    );
  });

  test("day-of-month and day-of-week use OR semantics when both are restricted", () => {
    // The 1st of the month, OR any Monday.
    const schedule = parseCronExpression("0 0 1 * 1");
    // 2026-03-10 is a Tuesday; the next Monday is the 16th.
    expect(iso(nextCronFireTime(schedule, anchor))).toBe("2026-03-16T00:00:00.000Z");
    // ...and the 1st of April fires even though it is a Wednesday.
    expect(iso(nextCronFireTime(schedule, at("2026-03-30T12:00:00.000Z")))).toBe(
      "2026-04-01T00:00:00.000Z"
    );
  });

  test("a day list plus a weekday still ORs", () => {
    const schedule = parseCronExpression("0 0 1,15 * 1");
    // 2026-03-10 is a Tuesday: the 15th (a Sunday) arrives before the 16th.
    expect(iso(nextCronFireTime(schedule, anchor))).toBe("2026-03-15T00:00:00.000Z");
  });

  test("a day field beginning with * keeps AND semantics (Vixie parity)", () => {
    // Vixie tests the LEADING character, so `*/2` is a "star" field: the
    // expression means "an odd day of the month AND a Monday", not "or".
    const schedule = parseCronExpression("0 0 */2 * 1");
    expect(schedule.dayOfMonthRestricted).toBe(false);
    expect(schedule.dayOfWeekRestricted).toBe(true);
    // Mondays after the Tuesday anchor are the 16th (even, no match) and the
    // 23rd (odd, match). Under OR semantics this would answer the 11th.
    expect(iso(nextCronFireTime(schedule, anchor))).toBe("2026-03-23T00:00:00.000Z");
  });

  test("a restricted day-of-month alone must match (no OR fallback)", () => {
    const schedule = parseCronExpression("0 0 1 * *");
    expect(iso(nextCronFireTime(schedule, at("2026-03-16T00:00:00.000Z")))).toBe(
      "2026-04-01T00:00:00.000Z"
    );
  });

  test("a restricted day-of-week alone must match (no OR fallback)", () => {
    const schedule = parseCronExpression("0 0 * * 1");
    expect(iso(nextCronFireTime(schedule, at("2026-03-10T00:00:00.000Z")))).toBe(
      "2026-03-16T00:00:00.000Z"
    );
  });

  test("throws a typed error for a satisfiable-looking but impossible expression", () => {
    const schedule = parseCronExpression("0 0 30 2 *");
    expect(() => nextCronFireTime(schedule, anchor)).toThrow(CronUnsatisfiableError);
    expect(() => nextCronFireTime(schedule, anchor)).toThrow(TriggerError);
  });
});
