/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter, getLogger, uuid4 } from "@workglow/util";
import type {
  ITrigger,
  ITriggerFireContext,
  OverlapPolicy,
  TriggerEventListener,
  TriggerEventListeners,
  TriggerEventParameters,
  TriggerEvents,
  TriggerHandler,
  TriggerStartOptions,
} from "./ITrigger";
import { OVERLAP_POLICIES } from "./ITrigger";
import { TriggerConfigurationError } from "./TriggerError";

/**
 * Largest delay a host timer accepts. A larger value overflows the 32-bit
 * delay and fires immediately, so long waits are scheduled in chunks.
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Options common to every built-in trigger. */
export interface TriggerOptions {
  /** Stable id; a UUID is generated when omitted. */
  readonly id?: string | undefined;
  /** See {@link OverlapPolicy}. Defaults to `"skip"`. */
  readonly overlap?: OverlapPolicy | undefined;
  /** Backlog bound for the `"queue"` policy. Defaults to `1`. */
  readonly maxQueuedFires?: number | undefined;
  /**
   * Call `unref()` on the scheduled timer where the host supports it (Node and
   * Bun; a browser's numeric handle has no such method and is left alone).
   *
   * A running trigger otherwise keeps a Node process alive, which is the right
   * default for a server but wrong for a CLI or a test that forgets `stop()`.
   */
  readonly unrefTimer?: boolean | undefined;
}

/**
 * Everything one {@link BaseTrigger.start} owns: the handler, the abort
 * plumbing, the pending timer, and the overlap counters.
 *
 * The OBJECT IDENTITY is the generation token. Every scheduling and dispatch
 * path takes its run as a parameter instead of reading `this`, so a chain left
 * over from a previous `start()` physically cannot see a newer run's counters,
 * shift its queued ticks, or invoke its handler with a stale (already aborted)
 * signal. A `stop()` that is still draining therefore cannot disturb a restart.
 */
export interface TriggerRun {
  /** Handler registered by the `start()` that created this run. */
  readonly handler: TriggerHandler;
  /** Aborted by `stop()`; the source of {@link TriggerRun.signal}. */
  readonly controller: AbortController;
  /** Signal handed to handlers — the controller, linked with any caller signal. */
  readonly signal: AbortSignal;
  /** Scheduled instants held back by the `"queue"` overlap policy. */
  readonly queued: number[];
  /** Tick chains that have not settled yet; `stop()` awaits these. */
  readonly pending: Set<Promise<void>>;
  /** Handle of the pending tick, if one is scheduled. */
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Handler invocations currently in flight. */
  inFlight: number;
  /** False from the moment `stop()` is entered; nothing new is scheduled after. */
  active: boolean;
  /** Detaches the caller-signal abort listener, when one was registered. */
  removeExternalAbort: (() => void) | undefined;
  /** The in-flight `stop()` for this run, so a second `stop()` joins it. */
  stopping: Promise<void> | undefined;
}

/**
 * Shared lifecycle for the pure-timer triggers: absolute-time scheduling,
 * overlap gating, abort wiring, and error isolation.
 *
 * Subclasses implement {@link computeNextFireTime} and may override
 * {@link runTick} to resolve a payload before the handler is invoked.
 *
 * The next tick is scheduled BEFORE the handler runs and is computed from the
 * tick's own scheduled instant, so handler duration never accumulates into the
 * schedule — the recurring `setInterval` drift bug cannot occur here.
 */
export abstract class BaseTrigger implements ITrigger {
  public readonly id: string;
  public abstract readonly kind: string;
  public readonly events = new EventEmitter<TriggerEventListeners>();

  protected readonly overlap: OverlapPolicy;
  protected readonly maxQueuedFires: number;
  protected readonly unrefTimer: boolean;

  /** The current run, or `undefined` when the trigger is stopped and drained. */
  private _run: TriggerRun | undefined;

  constructor(options: TriggerOptions = {}) {
    this.id = options.id ?? uuid4();
    this.overlap = options.overlap ?? "skip";
    if (!(OVERLAP_POLICIES as readonly string[]).includes(this.overlap)) {
      throw new TriggerConfigurationError(
        `Unknown overlap policy "${this.overlap}". Expected one of: ${OVERLAP_POLICIES.join(", ")}.`
      );
    }
    this.maxQueuedFires = options.maxQueuedFires ?? 1;
    if (!Number.isInteger(this.maxQueuedFires) || this.maxQueuedFires < 1) {
      throw new TriggerConfigurationError(
        `maxQueuedFires must be a positive integer, received ${String(options.maxQueuedFires)}.`
      );
    }
    this.unrefTimer = options.unrefTimer ?? false;
  }

  public get running(): boolean {
    return this._run?.active === true;
  }

  public on<Event extends TriggerEvents>(name: Event, fn: TriggerEventListener<Event>): void {
    this.events.on(name, fn);
  }

  public off<Event extends TriggerEvents>(name: Event, fn: TriggerEventListener<Event>): void {
    this.events.off(name, fn);
  }

  public once<Event extends TriggerEvents>(name: Event, fn: TriggerEventListener<Event>): void {
    this.events.once(name, fn);
  }

  /**
   * @throws whatever {@link computeNextFireTime} throws (a `CronTrigger` whose
   *   expression matches no instant within the search horizon raises
   *   `CronUnsatisfiableError` here). The first fire time is computed BEFORE any
   *   state is touched, so a throw leaves the trigger exactly as it was — still
   *   stopped, with nothing scheduled and no listener attached.
   */
  public start(handler: TriggerHandler, options: TriggerStartOptions = {}): void {
    // Starting twice is a no-op rather than an error, so a start/start/stop
    // sequence leaves no orphaned timer behind.
    if (this.running) return;
    // An already-aborted caller signal means "do not schedule anything".
    if (options.signal?.aborted) return;

    // Compute first, mutate second. Setting `_run` before a computation that can
    // throw would leave the trigger reporting `running` with no timer, and every
    // later `start()` would be a silent no-op forever.
    const firstFireAt = this.computeNextFireTime(Date.now());

    const controller = new AbortController();
    const run: TriggerRun = {
      handler,
      controller,
      signal: options.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal,
      queued: [],
      pending: new Set(),
      timer: undefined,
      inFlight: 0,
      active: true,
      removeExternalAbort: undefined,
      stopping: undefined,
    };
    this._run = run;

    if (options.signal) {
      const externalSignal = options.signal;
      const onExternalAbort = (): void => {
        // `.catch` rather than `void`: a `stop` listener that throws would
        // otherwise reject a floating promise and take a Node host down with an
        // unhandledRejection. `stop()` reports its own failures.
        this.stop().catch(() => {});
      };
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      run.removeExternalAbort = () => externalSignal.removeEventListener("abort", onExternalAbort);
    }

    this.scheduleAt(run, firstFireAt);
    this.safeEmit("start");
  }

  /**
   * Cancels the pending tick, aborts the signal handed to handlers, and
   * resolves once every in-flight handler for this run has settled.
   *
   * Concurrent calls join the same drain: the second call returns the first
   * call's promise rather than resolving early, so `await stop()` always means
   * "no handler of that run is still running".
   */
  public stop(): Promise<void> {
    const run = this._run;
    if (!run) return Promise.resolve();
    if (run.stopping) return run.stopping;

    run.active = false;
    if (run.timer !== undefined) {
      clearTimeout(run.timer);
      run.timer = undefined;
    }
    run.queued.length = 0;
    run.removeExternalAbort?.();
    run.removeExternalAbort = undefined;

    // Record the drain BEFORE aborting: an abort listener that re-enters
    // `stop()` must join this drain instead of starting a second one.
    const stopping = this.releaseWhenIdle(run);
    run.stopping = stopping;
    run.controller.abort();
    return stopping;
  }

  /**
   * Absolute instant (ms since epoch) of the tick following `fromMs`. Must be
   * strictly greater than `fromMs` so a computation landing exactly on a
   * boundary advances instead of firing the same tick forever.
   */
  protected abstract computeNextFireTime(fromMs: number): number;

  /**
   * Runs one tick. The default invokes the handler with no payload; a subclass
   * that resolves data first (see `PollingTrigger`) overrides this and may
   * decline to invoke the handler at all. A throw here is caught by the loop,
   * reported on the `error` event, and does not stop the trigger.
   *
   * The run is passed explicitly — read `run.signal`, never a field on `this` —
   * so a chain belonging to a superseded generation stays on its own state.
   */
  protected async runTick(scheduledAt: number, run: TriggerRun): Promise<void> {
    await this.invokeHandler(run, {
      triggerId: this.id,
      scheduledAt,
      signal: run.signal,
      payload: undefined,
    });
  }

  /** Emits `fire` and awaits the run's registered handler. */
  protected async invokeHandler(run: TriggerRun, context: ITriggerFireContext): Promise<void> {
    this.safeEmit("fire", context);
    await run.handler(context);
  }

  /**
   * Called once a run has stopped and every handler it started has settled, so
   * a subclass can release per-generation state (see `PollingTrigger`).
   *
   * NOT called when a newer `start()` has already taken over: that run owns the
   * subclass state now, and resetting it here would corrupt it.
   */
  protected onRunStopped(): void {}

  private async releaseWhenIdle(run: TriggerRun): Promise<void> {
    // A loop, not a single `allSettled`: a chain draining queued ticks may still
    // be adding work when the first snapshot is taken.
    while (run.pending.size > 0) {
      await Promise.allSettled([...run.pending]);
    }

    // A `start()` during the drain installed a newer run; releasing subclass
    // state or clearing `_run` here would strand it.
    if (this._run === run) {
      this._run = undefined;
      this.onRunStopped();
    }
    this.safeEmit("stop");
  }

  private scheduleAt(run: TriggerRun, targetMs: number): void {
    const remaining = Math.max(0, targetMs - Date.now());
    const timer = setTimeout(
      () => {
        run.timer = undefined;
        if (!run.active) return;
        // A chunked wait (or an early host timer) lands before the target.
        if (Date.now() < targetMs) {
          this.scheduleAt(run, targetMs);
          return;
        }
        this.onTick(run, targetMs);
      },
      Math.min(remaining, MAX_TIMER_DELAY_MS)
    );
    run.timer = timer;
    if (this.unrefTimer) {
      // Node/Bun return a Timeout object; a browser returns a number.
      (timer as unknown as { unref?: () => void }).unref?.();
    }
  }

  private onTick(run: TriggerRun, scheduledAt: number): void {
    let nextFireAt: number;
    try {
      nextFireAt = this.computeNextFireTime(scheduledAt);
    } catch (error) {
      // Nothing can be scheduled, so there is no half-live state worth keeping:
      // report and shut down rather than leave a trigger that reports `running`
      // and will never fire again.
      this.reportError(error, scheduledAt);
      this.stop().catch(() => {});
      return;
    }
    this.scheduleAt(run, nextFireAt);
    this.dispatch(run, scheduledAt);
  }

  private dispatch(run: TriggerRun, scheduledAt: number): void {
    if (this.overlap !== "concurrent" && (run.inFlight > 0 || run.queued.length > 0)) {
      if (this.overlap === "queue" && run.queued.length < this.maxQueuedFires) {
        run.queued.push(scheduledAt);
        return;
      }
      this.safeEmit("skip", scheduledAt);
      getLogger().warn("Trigger fire skipped; previous handler still running", {
        triggerId: this.id,
        kind: this.kind,
        scheduledAt,
        overlap: this.overlap,
      });
      return;
    }

    const chain = this.runTickChain(run, scheduledAt);
    run.pending.add(chain);
    // `catch` before `finally`: `runTickChain` reports handler errors itself,
    // but an `error` LISTENER that throws rejects the chain, and a bare
    // `chain.finally(...)` would surface that as an unhandled rejection —
    // crashing a Node host whose only fault was a noisy listener. `stop()`
    // still awaits `chain` itself through `allSettled`.
    void chain.catch(() => {}).finally(() => run.pending.delete(chain));
  }

  /**
   * Runs a tick and then drains queued ticks iteratively — a recursive drain
   * would keep every queued frame alive for the lifetime of the trigger.
   */
  private async runTickChain(run: TriggerRun, first: number): Promise<void> {
    let scheduledAt: number | undefined = first;
    while (scheduledAt !== undefined) {
      run.inFlight += 1;
      try {
        await this.runTick(scheduledAt, run);
      } catch (error) {
        this.reportError(error, scheduledAt);
      } finally {
        run.inFlight -= 1;
      }
      // Only this run's queue: a superseded chain must never shift a tick a
      // newer generation queued, nor hand it the newer handler.
      scheduledAt = run.active ? run.queued.shift() : undefined;
    }
  }

  private reportError(error: unknown, scheduledAt: number): void {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    this.safeEmit("error", wrapped);
    getLogger().error("Trigger handler failed", {
      triggerId: this.id,
      kind: this.kind,
      scheduledAt,
      error: wrapped.message,
    });
  }

  /**
   * Emits without letting a listener's throw escape.
   *
   * `EventEmitter.emit` deliberately RE-THROWS what listeners throw, which is
   * load-bearing elsewhere in the monorepo but fatal here: most of these emits
   * happen inside a `setTimeout` callback, where a throw is an
   * uncaughtException that takes the process down — a `metrics.inc(...)` on a
   * torn-down client is enough. A failing listener is reported on `error`
   * instead, and an `error` listener that itself throws is only logged, so this
   * can never recurse.
   */
  private safeEmit<Event extends TriggerEvents>(
    name: Event,
    ...args: TriggerEventParameters<Event>
  ): void {
    try {
      this.events.emit(name, ...args);
    } catch (error) {
      const wrapped = error instanceof Error ? error : new Error(String(error));
      if (name !== "error") {
        try {
          this.events.emit("error", wrapped);
        } catch {
          // Nowhere left to report it; the log below is the last word.
        }
      }
      getLogger().error("Trigger event listener failed", {
        triggerId: this.id,
        kind: this.kind,
        event: name,
        error: wrapped.message,
      });
    }
  }
}
