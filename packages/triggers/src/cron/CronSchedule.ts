/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CronExpressionError, CronUnsatisfiableError } from "../trigger/TriggerError";

/**
 * A parsed 5-field cron expression: `minute hour day-of-month month day-of-week`.
 *
 * Every set is expanded at parse time, and all matching is done in **UTC** —
 * see {@link parseCronExpression} for the supported syntax and the rationale.
 */
export interface CronSchedule {
  /** The expression this schedule was parsed from, whitespace-normalized. */
  readonly expression: string;
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly daysOfMonth: ReadonlySet<number>;
  /** 1-12. */
  readonly months: ReadonlySet<number>;
  /** 0-6, Sunday = 0. A `7` in the expression is normalized to `0`. */
  readonly daysOfWeek: ReadonlySet<number>;
  /** True when the day-of-month field is anything other than `*`. */
  readonly dayOfMonthRestricted: boolean;
  /** True when the day-of-week field is anything other than `*`. */
  readonly dayOfWeekRestricted: boolean;
}

interface CronFieldSpec {
  readonly name: string;
  readonly min: number;
  readonly max: number;
}

const MINUTE_FIELD: CronFieldSpec = { name: "minute", min: 0, max: 59 };
const HOUR_FIELD: CronFieldSpec = { name: "hour", min: 0, max: 23 };
const DAY_OF_MONTH_FIELD: CronFieldSpec = { name: "day-of-month", min: 1, max: 31 };
const MONTH_FIELD: CronFieldSpec = { name: "month", min: 1, max: 12 };
// 7 is accepted as an alias for Sunday and normalized to 0.
const DAY_OF_WEEK_FIELD: CronFieldSpec = { name: "day-of-week", min: 0, max: 7 };

const CRON_FIELD_COUNT = 5;

const MINUTE_MS = 60_000;

/** How far ahead {@link nextCronFireTime} searches before declaring an expression unsatisfiable. */
const MAX_SEARCH_YEARS = 5;

/**
 * Parses a 5-field cron expression.
 *
 * Supported per field: `*`, `N`, `a,b`, `a-b`, `*&#47;n`, `a-b&#47;n`. Anything
 * else — macros (`@daily`), month/day NAMES (`JAN`, `MON`), a seconds field, and
 * the Quartz extensions `L`, `W`, `#`, `?` — is rejected with a
 * {@link CronExpressionError} rather than silently reinterpreted.
 *
 * Fields are matched in **UTC**. A local-time cron needs a timezone database and
 * an answer for DST-ambiguous instants (a 2:30am daily job runs twice on one day
 * a year and zero times on another); UTC has no such gaps, so it is the only
 * dialect this package will guess at.
 *
 * Day-of-month and day-of-week use standard cron **OR** semantics: when both are
 * restricted a day matches if EITHER matches, so `0 0 1 * 1` fires on the 1st of
 * the month AND on every Monday.
 */
export function parseCronExpression(expression: string): CronSchedule {
  if (typeof expression !== "string") {
    throw new CronExpressionError(
      `Cron expression must be a string, received ${typeof expression}.`
    );
  }
  const normalized = expression.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    throw new CronExpressionError("Cron expression must not be empty.");
  }
  const fields = normalized.split(" ");
  if (fields.length !== CRON_FIELD_COUNT) {
    throw new CronExpressionError(
      `Cron expression "${expression}" has ${fields.length} field(s); exactly ${CRON_FIELD_COUNT} ` +
        `are required (minute hour day-of-month month day-of-week).`
    );
  }

  const [minuteRaw, hourRaw, dayOfMonthRaw, monthRaw, dayOfWeekRaw] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];

  const daysOfWeek = new Set(
    [...parseField(dayOfWeekRaw, DAY_OF_WEEK_FIELD, normalized)].map((day) => day % 7)
  );

  return {
    expression: normalized,
    minutes: parseField(minuteRaw, MINUTE_FIELD, normalized),
    hours: parseField(hourRaw, HOUR_FIELD, normalized),
    daysOfMonth: parseField(dayOfMonthRaw, DAY_OF_MONTH_FIELD, normalized),
    months: parseField(monthRaw, MONTH_FIELD, normalized),
    daysOfWeek,
    dayOfMonthRestricted: dayOfMonthRaw !== "*",
    dayOfWeekRestricted: dayOfWeekRaw !== "*",
  };
}

function parseField(raw: string, spec: CronFieldSpec, expression: string): ReadonlySet<number> {
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    for (const value of parseFieldPart(part, spec, expression)) {
      values.add(value);
    }
  }
  return values;
}

function parseFieldPart(part: string, spec: CronFieldSpec, expression: string): number[] {
  if (part.length === 0) {
    throw fieldError(part, spec, expression, "it contains an empty list entry");
  }

  const [rangeText, stepText, ...extra] = part.split("/");
  if (extra.length > 0 || rangeText === undefined) {
    throw fieldError(part, spec, expression, "it has more than one step separator");
  }

  let step = 1;
  if (stepText !== undefined) {
    if (!/^\d+$/.test(stepText)) {
      throw fieldError(part, spec, expression, `"${stepText}" is not a positive step`);
    }
    step = Number(stepText);
    if (step === 0) {
      throw fieldError(part, spec, expression, "a step of 0 is not a valid increment");
    }
  }

  let start: number;
  let end: number;
  if (rangeText === "*") {
    start = spec.min;
    end = spec.max;
  } else if (rangeText.includes("-")) {
    const [startText, endText, ...rest] = rangeText.split("-");
    if (rest.length > 0 || startText === undefined || endText === undefined) {
      throw fieldError(part, spec, expression, `"${rangeText}" is not a valid range`);
    }
    start = parseNumber(startText, part, spec, expression);
    end = parseNumber(endText, part, spec, expression);
    if (start > end) {
      throw fieldError(part, spec, expression, `range ${start}-${end} is inverted`);
    }
  } else if (stepText !== undefined) {
    // `a/n` (Vixie's open-ended step) is deliberately unsupported: it reads like
    // "every n starting at a" but means different things across dialects.
    throw fieldError(
      part,
      spec,
      expression,
      `a step needs an explicit range — write "${rangeText}-${spec.max}/${step}" or "*/${step}"`
    );
  } else {
    start = parseNumber(rangeText, part, spec, expression);
    end = start;
  }

  const values: number[] = [];
  for (let value = start; value <= end; value += step) {
    values.push(value);
  }
  return values;
}

function parseNumber(text: string, part: string, spec: CronFieldSpec, expression: string): number {
  if (!/^\d+$/.test(text)) {
    throw fieldError(
      part,
      spec,
      expression,
      `"${text}" is not a number (names such as JAN or MON are not supported)`
    );
  }
  const value = Number(text);
  if (value < spec.min || value > spec.max) {
    throw fieldError(part, spec, expression, `${value} is outside ${spec.min}-${spec.max}`);
  }
  return value;
}

function fieldError(
  part: string,
  spec: CronFieldSpec,
  expression: string,
  reason: string
): CronExpressionError {
  return new CronExpressionError(
    `Invalid ${spec.name} "${part}" in cron expression "${expression}": ${reason}.`
  );
}

/**
 * The first instant matching `schedule` STRICTLY AFTER `afterMs`, in UTC.
 *
 * Strictly after is what makes the trigger loop terminate: computing the next
 * fire from a tick that landed exactly on a boundary must move forward, not
 * return the same instant again.
 *
 * @throws CronUnsatisfiableError when nothing matches within {@link MAX_SEARCH_YEARS}
 *   (for example `0 0 30 2 *` — February never has a 30th).
 */
export function nextCronFireTime(schedule: CronSchedule, afterMs: number): number {
  const from = new Date(afterMs);
  // Truncate to the minute, then step one minute: cron has minute resolution,
  // and the result must be strictly after `afterMs`.
  let candidate =
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      from.getUTCHours(),
      from.getUTCMinutes()
    ) + MINUTE_MS;
  const limit = Date.UTC(
    from.getUTCFullYear() + MAX_SEARCH_YEARS,
    from.getUTCMonth(),
    from.getUTCDate(),
    from.getUTCHours(),
    from.getUTCMinutes()
  );

  while (candidate <= limit) {
    const date = new Date(candidate);
    const year = date.getUTCFullYear();
    const monthIndex = date.getUTCMonth();

    if (!schedule.months.has(monthIndex + 1)) {
      candidate = Date.UTC(year, monthIndex + 1, 1, 0, 0);
      continue;
    }
    if (!matchesDay(schedule, date)) {
      candidate = Date.UTC(year, monthIndex, date.getUTCDate() + 1, 0, 0);
      continue;
    }
    if (!schedule.hours.has(date.getUTCHours())) {
      candidate = Date.UTC(year, monthIndex, date.getUTCDate(), date.getUTCHours() + 1, 0);
      continue;
    }
    if (!schedule.minutes.has(date.getUTCMinutes())) {
      candidate += MINUTE_MS;
      continue;
    }
    return candidate;
  }

  throw new CronUnsatisfiableError(
    `Cron expression "${schedule.expression}" has no matching time within ${MAX_SEARCH_YEARS} years ` +
      `of ${new Date(afterMs).toISOString()}.`
  );
}

function matchesDay(schedule: CronSchedule, date: Date): boolean {
  const dayOfMonth = date.getUTCDate();
  const dayOfWeek = date.getUTCDay();
  if (schedule.dayOfMonthRestricted && schedule.dayOfWeekRestricted) {
    return schedule.daysOfMonth.has(dayOfMonth) || schedule.daysOfWeek.has(dayOfWeek);
  }
  if (schedule.dayOfMonthRestricted) return schedule.daysOfMonth.has(dayOfMonth);
  if (schedule.dayOfWeekRestricted) return schedule.daysOfWeek.has(dayOfWeek);
  return true;
}
