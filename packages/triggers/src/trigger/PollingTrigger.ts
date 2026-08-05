/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TriggerOptions } from "./BaseTrigger";
import { BaseTrigger } from "./BaseTrigger";
import { TRIGGER_KINDS } from "./ITrigger";
import { TriggerConfigurationError } from "./TriggerError";

/** Decides whether a poll result should fire the handler. */
export type PollResultPredicate<Result> = (result: Result, previous: Result | undefined) => boolean;

/**
 * Default {@link PollResultPredicate}: fires on a NON-EMPTY result. `undefined`,
 * `null`, an empty array, and an empty string are empty; everything else —
 * including `0` and `false` — fires.
 */
export function isNonEmptyPollResult(result: unknown): boolean {
  if (result === undefined || result === null) return false;
  if (Array.isArray(result)) return result.length > 0;
  if (typeof result === "string") return result.length > 0;
  return true;
}

/**
 * Ready-made {@link PollResultPredicate} for change detection: fires when the
 * result differs from the previously polled one by `Object.is`. Reference
 * equality, so supply your own predicate when polling freshly-built objects.
 */
export function firesOnChange<Result>(result: Result, previous: Result | undefined): boolean {
  return !Object.is(result, previous);
}

export interface PollingTriggerOptions<Result> extends TriggerOptions {
  /** Period between polls, in milliseconds. Must be a positive integer. */
  readonly intervalMs: number;
  /** Called on every tick. Receives the trigger's abort signal. */
  readonly poll: (signal: AbortSignal) => Result | Promise<Result>;
  /**
   * Whether a given poll result fires the handler. Defaults to
   * {@link isNonEmptyPollResult}; pass {@link firesOnChange} for
   * change-detection semantics.
   */
  readonly shouldFire?: PollResultPredicate<Result> | undefined;
}

/**
 * Polls on a fixed period and fires the handler only when the poll result is
 * interesting — by default when it is non-empty. That conditional fire is the
 * whole difference from `IntervalTrigger`, which fires on every tick.
 *
 * The poll result is handed to the handler as `context.payload`. A poll that
 * throws is reported on the `error` event and does not stop the loop; the
 * previous result is left unchanged so the next comparison is against the last
 * value actually observed.
 */
export class PollingTrigger<Result = unknown> extends BaseTrigger {
  public readonly kind = TRIGGER_KINDS.polling;
  public readonly intervalMs: number;

  private readonly _poll: (signal: AbortSignal) => Result | Promise<Result>;
  private readonly _shouldFire: PollResultPredicate<Result>;
  private _previous: Result | undefined;

  constructor(options: PollingTriggerOptions<Result>) {
    super(options);
    if (!Number.isInteger(options.intervalMs) || options.intervalMs <= 0) {
      throw new TriggerConfigurationError(
        `intervalMs must be a positive integer, received ${String(options.intervalMs)}.`
      );
    }
    if (typeof options.poll !== "function") {
      throw new TriggerConfigurationError("poll must be a function.");
    }
    this.intervalMs = options.intervalMs;
    this._poll = options.poll;
    this._shouldFire = options.shouldFire ?? ((result) => isNonEmptyPollResult(result));
  }

  /** Most recent successfully polled result, or `undefined` before the first poll. */
  public get lastResult(): Result | undefined {
    return this._previous;
  }

  protected computeNextFireTime(fromMs: number): number {
    const next = fromMs + this.intervalMs;
    const now = Date.now();
    if (next > now) return next;
    const missedPeriods = Math.floor((now - next) / this.intervalMs) + 1;
    return next + missedPeriods * this.intervalMs;
  }

  protected override async runTick(scheduledAt: number, signal: AbortSignal): Promise<void> {
    const result = await this._poll(signal);
    const previous = this._previous;
    this._previous = result;
    if (signal.aborted) return;
    if (!this._shouldFire(result, previous)) return;
    await this.invokeHandler({
      triggerId: this.id,
      scheduledAt,
      signal,
      payload: result,
    });
  }
}
