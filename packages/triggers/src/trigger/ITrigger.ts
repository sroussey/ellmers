/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventEmitter, EventParameters } from "@workglow/util";

/** Built-in trigger kinds. Third-party triggers may report any other string. */
export const TRIGGER_KINDS = {
  interval: "interval",
  polling: "polling",
  cron: "cron",
} as const;

export type TriggerKind = (typeof TRIGGER_KINDS)[keyof typeof TRIGGER_KINDS];

/**
 * What a trigger does when a tick comes due while the previous handler is still
 * running.
 *
 * - `skip` (default) — the tick is dropped. A trigger is a clock, not a work
 *   queue: a handler that consistently outlasts its period would otherwise grow
 *   an unbounded backlog. The dropped tick emits `skip` and logs a warning.
 * - `queue` — the tick is held and run when the in-flight handler settles,
 *   bounded by `maxQueuedFires`. Ticks past that bound behave like `skip`.
 * - `concurrent` — the handler is invoked immediately regardless of what is
 *   still in flight. Overlap becomes the handler's problem.
 */
export const OVERLAP_POLICIES = ["skip", "queue", "concurrent"] as const;

export type OverlapPolicy = (typeof OVERLAP_POLICIES)[number];

/** Payload handed to a {@link TriggerHandler} on each fire. */
export interface ITriggerFireContext {
  /** Id of the trigger that fired. */
  readonly triggerId: string;
  /**
   * Wall-clock instant (ms since epoch) the tick was SCHEDULED for, which is
   * what schedules are computed against. It can predate the actual invocation
   * when the host event loop is busy — use it, not `Date.now()`, when a handler
   * needs the logical fire time.
   */
  readonly scheduledAt: number;
  /**
   * Aborted when the trigger stops. Handlers that do meaningful work should
   * forward it so an in-flight run can cancel instead of outliving the trigger.
   */
  readonly signal: AbortSignal;
  /**
   * Trigger-specific data. `undefined` for interval and cron triggers; the poll
   * result for a polling trigger.
   */
  readonly payload: unknown;
}

/** Invoked on every fire. A rejection never stops the trigger loop. */
export type TriggerHandler = (context: ITriggerFireContext) => void | Promise<void>;

export type TriggerEventListeners = {
  /** The trigger began scheduling. */
  start: () => void;
  /** The trigger stopped and any in-flight handler has settled. */
  stop: () => void;
  /** A handler invocation is about to begin. */
  fire: (context: ITriggerFireContext) => void;
  /**
   * A due tick was dropped because a handler was still in flight (`skip`
   * policy, or a `queue` policy past `maxQueuedFires`).
   */
  skip: (scheduledAt: number) => void;
  /**
   * A handler (or a polling trigger's poll function) threw or rejected.
   * Carries the REAL Error — not a stringified one — so listeners can do
   * `instanceof` checks and read `.stack`.
   */
  error: (error: Error) => void;
};

export type TriggerEvents = keyof TriggerEventListeners;
export type TriggerEventListener<Event extends TriggerEvents> = TriggerEventListeners[Event];
export type TriggerEventParameters<Event extends TriggerEvents> = EventParameters<
  TriggerEventListeners,
  Event
>;

/** Options accepted by {@link ITrigger.start}. */
export interface TriggerStartOptions {
  /**
   * Caller-owned cancellation. Aborting it stops the trigger exactly as
   * {@link ITrigger.stop} does; it is linked with the trigger's own controller
   * via `AbortSignal.any`, so handlers see a single combined signal.
   */
  readonly signal?: AbortSignal | undefined;
}

/**
 * A source of workflow invocations.
 *
 * Implementations are pure in-process schedulers: nothing is persisted, so a
 * process restart loses the schedule and a fire is delivered at most once, to
 * this process only. Durable and distributed triggers are a separate concern.
 */
export interface ITrigger {
  /** Stable identifier, used in logs and by the workflow bindings. */
  readonly id: string;
  /** Discriminator for the trigger implementation; see {@link TRIGGER_KINDS}. */
  readonly kind: string;
  /** True between a successful {@link start} and {@link stop}. */
  readonly running: boolean;
  readonly events: EventEmitter<TriggerEventListeners>;

  /**
   * Begins scheduling. Calling this on an already-running trigger is a no-op,
   * so a start/start/stop sequence leaves nothing scheduled.
   *
   * @throws when the first fire time cannot be computed — a `CronTrigger` whose
   *   expression matches no instant within the search horizon raises
   *   `CronUnsatisfiableError`. The computation happens before any state is
   *   touched, so a throwing `start()` leaves the trigger stopped with nothing
   *   scheduled; callers that start several triggers should stop the ones they
   *   already started.
   */
  start(handler: TriggerHandler, options?: TriggerStartOptions): void;

  /**
   * Cancels the pending tick, aborts the signal handed to handlers, and
   * resolves once any in-flight handler has settled — so a caller that awaits
   * `stop()` knows no handler is still running. Concurrent calls join the same
   * drain rather than resolving early.
   */
  stop(): Promise<void>;

  on<Event extends TriggerEvents>(name: Event, fn: TriggerEventListener<Event>): void;
  off<Event extends TriggerEvents>(name: Event, fn: TriggerEventListener<Event>): void;
  once<Event extends TriggerEvents>(name: Event, fn: TriggerEventListener<Event>): void;
}
