/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TriggerOptions, TriggerRun } from "./BaseTrigger";
import { BaseTrigger } from "./BaseTrigger";
import { assertValidIntervalMs, nextFixedIntervalFireTime } from "./fixedInterval";
import { TRIGGER_KINDS } from "./ITrigger";

export interface IntervalTriggerOptions extends TriggerOptions {
  /** Period between fires, in milliseconds. Must be a positive integer. */
  readonly intervalMs: number;
}

/**
 * Fires every `intervalMs`, starting one full period after {@link start} — it
 * never fires immediately.
 *
 * Each tick is scheduled from the previous tick's SCHEDULED instant rather than
 * from when its handler finished, so the fire times stay on the phase
 * established at `start()` no matter how long a handler runs. If the host is
 * suspended past one or more periods, the missed periods are dropped (the
 * schedule jumps to the next future instant on the same phase) instead of being
 * replayed as a burst.
 */
export class IntervalTrigger extends BaseTrigger {
  public readonly kind = TRIGGER_KINDS.interval;
  public readonly intervalMs: number;

  constructor(options: IntervalTriggerOptions) {
    super(options);
    this.intervalMs = assertValidIntervalMs(options.intervalMs);
  }

  protected computeNextFireTime(fromMs: number, _run: TriggerRun): number {
    return nextFixedIntervalFireTime(fromMs, this.intervalMs);
  }
}
