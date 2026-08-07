/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TriggerOptions, TriggerRun } from "./BaseTrigger";
import { BaseTrigger } from "./BaseTrigger";
import { assertValidIntervalMs, nextFixedIntervalFireTime } from "./fixedInterval";
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

/**
 * Exponential backoff applied after consecutive poll failures, so a dependency
 * that is hard down is not hammered at the full poll rate indefinitely.
 */
export interface PollErrorBackoff {
  /** Delay after the first failure, in milliseconds. A positive integer. */
  readonly initialMs: number;
  /** Ceiling the doubling stops at, in milliseconds. At least `initialMs`. */
  readonly maxMs: number;
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
  /**
   * Back off after consecutive poll failures instead of polling at the full
   * rate. Omitted (the default) keeps the fixed period no matter how the poll
   * fares. The counter resets on the first poll that does not throw.
   */
  readonly errorBackoff?: PollErrorBackoff | undefined;
}

/**
 * Polls on a fixed period and fires the handler only when the poll result is
 * interesting — by default when it is non-empty. That conditional fire is the
 * whole difference from `IntervalTrigger`, which fires on every tick.
 *
 * The poll result is handed to the handler as `context.payload`. A poll that
 * throws is reported on the `error` event and does not stop the loop; the
 * previous result is left unchanged so the next comparison is against the last
 * value actually observed. Pass `errorBackoff` to slow the loop down while a
 * dependency stays down instead of polling it at full rate.
 */
export class PollingTrigger<Result = unknown> extends BaseTrigger {
  public readonly kind = TRIGGER_KINDS.polling;
  public readonly intervalMs: number;

  private readonly _poll: (signal: AbortSignal) => Result | Promise<Result>;
  private readonly _shouldFire: PollResultPredicate<Result>;
  private readonly _errorBackoff: PollErrorBackoff | undefined;
  private _previous: Result | undefined;
  private _consecutiveFailures = 0;

  constructor(options: PollingTriggerOptions<Result>) {
    super(options);
    this.intervalMs = assertValidIntervalMs(options.intervalMs);
    if (typeof options.poll !== "function") {
      throw new TriggerConfigurationError("poll must be a function.");
    }
    this._poll = options.poll;
    this._shouldFire = options.shouldFire ?? ((result) => isNonEmptyPollResult(result));
    this._errorBackoff = options.errorBackoff
      ? assertValidErrorBackoff(options.errorBackoff)
      : undefined;
  }

  /** Most recent successfully polled result, or `undefined` before the first poll. */
  public get lastResult(): Result | undefined {
    return this._previous;
  }

  /** Consecutive poll failures since the last poll that did not throw. */
  public get consecutiveFailures(): number {
    return this._consecutiveFailures;
  }

  protected computeNextFireTime(fromMs: number): number {
    const backoff = this._errorBackoff;
    if (backoff && this._consecutiveFailures > 0) {
      // The next tick was already scheduled when the failing one started, so the
      // backoff takes effect from the tick AFTER the first failure.
      const exponent = Math.min(this._consecutiveFailures - 1, 31);
      const delay = Math.min(backoff.maxMs, backoff.initialMs * 2 ** exponent);
      return fromMs + delay;
    }
    return nextFixedIntervalFireTime(fromMs, this.intervalMs);
  }

  protected override async runTick(scheduledAt: number, run: TriggerRun): Promise<void> {
    const signal = run.signal;
    let result: Result;
    try {
      result = await this._poll(signal);
    } catch (error) {
      this._consecutiveFailures += 1;
      throw error;
    }
    this._consecutiveFailures = 0;
    // Bail before recording the result: an aborted tick never fires, so keeping
    // its value as the baseline would make the NEXT `firesOnChange` comparison
    // see no change and swallow the very update this tick observed.
    if (signal.aborted) return;
    const previous = this._previous;
    this._previous = result;
    if (!this._shouldFire(result, previous)) return;
    await this.invokeHandler(run, {
      triggerId: this.id,
      scheduledAt,
      signal,
      payload: result,
    });
  }

  /**
   * The baseline and the failure streak belong to ONE run: a restart is a fresh
   * observation window, and a `firesOnChange` trigger comparing against a
   * baseline from the previous run would swallow the first change after it.
   */
  protected override onRunStopped(): void {
    this._previous = undefined;
    this._consecutiveFailures = 0;
  }
}

function assertValidErrorBackoff(backoff: PollErrorBackoff): PollErrorBackoff {
  if (!Number.isInteger(backoff.initialMs) || backoff.initialMs < 1) {
    throw new TriggerConfigurationError(
      `errorBackoff.initialMs must be a positive integer, received ${String(backoff.initialMs)}.`
    );
  }
  if (!Number.isInteger(backoff.maxMs) || backoff.maxMs < backoff.initialMs) {
    throw new TriggerConfigurationError(
      `errorBackoff.maxMs must be an integer >= initialMs (${backoff.initialMs}), ` +
        `received ${String(backoff.maxMs)}.`
    );
  }
  return backoff;
}
