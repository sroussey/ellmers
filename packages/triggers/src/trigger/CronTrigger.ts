/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CronSchedule } from "../cron/CronSchedule";
import { nextCronFireTime, parseCronExpression } from "../cron/CronSchedule";
import type { TriggerOptions, TriggerRun } from "./BaseTrigger";
import { BaseTrigger } from "./BaseTrigger";
import { TRIGGER_KINDS } from "./ITrigger";

export interface CronTriggerOptions extends TriggerOptions {
  /**
   * A 5-field cron expression, matched in UTC. See {@link parseCronExpression}
   * for the supported syntax; it throws on anything it does not support rather
   * than guessing.
   */
  readonly expression: string;
}

/**
 * Fires on the UTC instants matching a cron expression.
 *
 * The expression is parsed once in the constructor — an invalid expression
 * fails at construction, not at the first tick — and the next fire time is
 * recomputed from the calendar after every tick, so month lengths and leap days
 * are handled exactly rather than approximated by a fixed period.
 *
 * A wait longer than a host timer's ~24.8-day ceiling (a monthly schedule, for
 * instance) is served in chunks by the base class, so `0 0 1 * *` fires once per
 * month rather than immediately.
 */
export class CronTrigger extends BaseTrigger {
  public readonly kind = TRIGGER_KINDS.cron;
  public readonly schedule: CronSchedule;

  constructor(options: CronTriggerOptions) {
    super(options);
    this.schedule = parseCronExpression(options.expression);
  }

  /** The whitespace-normalized expression this trigger was built from. */
  public get expression(): string {
    return this.schedule.expression;
  }

  protected computeNextFireTime(fromMs: number, _run: TriggerRun): number {
    // Anchoring on the later of the tick's own instant and now means a host
    // that stalled past several cron instants resumes at the next FUTURE one
    // instead of replaying the missed ones back to back.
    return nextCronFireTime(this.schedule, Math.max(fromMs, Date.now()));
  }
}
