/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskAbortedError } from "@workglow/task-graph";
import { EventEmitter, getLogger, uuid4 } from "@workglow/util";
import { assertPositiveInteger } from "./assertions";
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
  TriggerStopOptions,
} from "./ITrigger";
import { OVERLAP_POLICIES } from "./ITrigger";
import { TriggerConfigurationError, TriggerStopTimeoutError } from "./TriggerError";

/**
 * Largest delay a host timer accepts. A larger value overflows the 32-bit
 * delay and fires immediately, so long waits are scheduled in chunks.
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Largest shortfall at timer expiry still attributable to a host firing a timer a
 * hair early. Anything larger, on a wait we did not truncate, means the wall clock
 * moved backwards under a monotonic timer.
 */
const EARLY_TIMER_TOLERANCE_MS = 50;

/** A `stop()` drain's deadline: the race arm, its cancellation, and its size. */
interface StopDeadline {
  readonly timeoutMs: number;
  readonly expired: Promise<"expired">;
  readonly cancel: () => void;
}

/**
 * Whether a rejection is a cancellation rather than a fault.
 *
 * The three shapes a stopped tick actually rejects with: the signal's own
 * `reason` (what `throwIfAborted()` re-throws), the platform `AbortError`
 * (`DOMException`, and the convention every hand-rolled one here follows), and
 * {@link TaskAbortedError} — what a `Workflow` run raises when its signal
 * fires, which is the common case since the workflow bindings are what most
 * handlers wrap. Anything else is a real failure that happened to land during
 * shutdown, and is reported.
 */
function isAbortShaped(error: unknown, signal: AbortSignal): boolean {
  if (error !== undefined && error === signal.reason) return true;
  if (error instanceof TaskAbortedError) return true;
  return error instanceof Error && error.name === "AbortError";
}

/** Options common to every built-in trigger. */
export interface TriggerOptions {
  /** Stable id; a UUID is generated when omitted. */
  readonly id?: string | undefined;
  /** See {@link OverlapPolicy}. Defaults to `"skip"`. */
  readonly overlap?: OverlapPolicy | undefined;
  /** Backlog bound for the `"queue"` policy. Defaults to `1`. */
  readonly maxQueuedFires?: number | undefined;
  /**
   * Ceiling on handler invocations in flight at once under
   * `overlap: "concurrent"`. A positive integer; unbounded by default.
   *
   * `"concurrent"` otherwise has no bound at all: a handler slower than the
   * period accumulates one more invocation every tick, forever, and the fan-out
   * is limited only by whatever the handler itself runs out of. A tick past the
   * ceiling behaves exactly like a `"skip"` — `skip` event, collapsed warning —
   * so the trigger stays a clock rather than becoming an unbounded work queue.
   *
   * Ignored by the other overlap policies, which already bound themselves.
   */
  readonly maxConcurrentFires?: number | undefined;
  /**
   * Default deadline for {@link BaseTrigger.stop}'s drain, in milliseconds. A
   * positive integer; unbounded by default. See
   * {@link TriggerStopOptions.timeoutMs} — the default MUST stay unbounded, or
   * the documented meaning of `await stop()` quietly stops being true.
   */
  readonly stopTimeoutMs?: number | undefined;
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
  /** Length of the current contiguous run of skipped ticks; 0 when not skipping. */
  skipStreak: number;
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
  protected readonly maxConcurrentFires: number;
  protected readonly stopTimeoutMs: number | undefined;
  protected readonly unrefTimer: boolean;

  /**
   * How the instants from {@link computeNextFireTime} are meant to be read.
   *
   * `"wall"` — a calendar appointment (`CronTrigger`). A timer that expires before
   * the clock reaches it has not reached the appointment: re-arm for the
   * remainder, which is what makes a backward NTP correction DELAY the fire rather
   * than misfire it.
   *
   * `"period"` — a bookkeeping anchor for "every N ms" (`IntervalTrigger`,
   * `PollingTrigger`). The timer, not the clock, measures the period, so an expiry
   * is a fire whatever the clock reads; re-arming on a backward step would stall
   * the trigger for the size of the step.
   */
  protected readonly clockDomain: "wall" | "period" = "period";

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
    this.maxQueuedFires =
      options.maxQueuedFires === undefined
        ? 1
        : assertPositiveInteger(options.maxQueuedFires, "maxQueuedFires");
    // Infinity, not a large number: the ceiling is genuinely absent by default,
    // and a sentinel would eventually be reached by a long-lived trigger.
    this.maxConcurrentFires =
      options.maxConcurrentFires === undefined
        ? Number.POSITIVE_INFINITY
        : assertPositiveInteger(options.maxConcurrentFires, "maxConcurrentFires");
    this.stopTimeoutMs =
      options.stopTimeoutMs === undefined
        ? undefined
        : assertPositiveInteger(options.stopTimeoutMs, "stopTimeoutMs");
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
    // Validated before anything else: a non-function handler otherwise starts a
    // trigger that reports `running` and emits a TypeError on `error` once per
    // period forever, with no way to tell it apart from a failing handler.
    if (typeof handler !== "function") {
      throw new TriggerConfigurationError(
        `start() requires a handler function, received ${typeof handler}.`
      );
    }
    // Starting twice is a no-op rather than an error, so a start/start/stop
    // sequence leaves no orphaned timer behind.
    if (this.running) return;
    // An already-aborted caller signal means "do not schedule anything".
    if (options.signal?.aborted) return;

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
      skipStreak: 0,
      active: true,
      removeExternalAbort: undefined,
      stopping: undefined,
    };

    // The run is built first so the hook has one to key its state off, but it is
    // published to `this._run` only after the computation that can throw. Setting
    // `_run` first would leave the trigger reporting `running` with no timer, and
    // every later `start()` would be a silent no-op forever.
    const firstFireAt = this.computeNextFireTime(Date.now(), run);
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
   * "no handler of that run is still running" — and the first call's deadline
   * is the one in force, since there is only ever one drain.
   *
   * Pass {@link TriggerStopOptions.timeoutMs} (or set `stopTimeoutMs` on the
   * trigger) to bound the drain. The deadline is OPT-IN, and deliberately so: a
   * bounded default would turn the sentence above into a lie for every caller
   * that never asked for one. Past the deadline the still-pending handlers are
   * abandoned — they keep running — and the expiry is reported on `error`.
   */
  public stop(options: TriggerStopOptions = {}): Promise<void> {
    const timeoutMs =
      options.timeoutMs === undefined
        ? this.stopTimeoutMs
        : assertPositiveInteger(options.timeoutMs, "timeoutMs");
    const run = this._run;
    if (!run) return Promise.resolve();
    if (run.stopping) return run.stopping;

    run.active = false;
    this.flushSkipStreak(run);
    if (run.timer !== undefined) {
      clearTimeout(run.timer);
      run.timer = undefined;
    }
    run.queued.length = 0;
    run.removeExternalAbort?.();
    run.removeExternalAbort = undefined;

    // Record the drain BEFORE aborting: an abort listener that re-enters
    // `stop()` must join this drain instead of starting a second one.
    const stopping = this.releaseWhenIdle(run, timeoutMs);
    run.stopping = stopping;
    run.controller.abort();
    return stopping;
  }

  /**
   * Absolute instant (ms since epoch) of the tick following `fromMs`. Must be
   * strictly greater than `fromMs` so a computation landing exactly on a
   * boundary advances instead of firing the same tick forever.
   *
   * The run whose schedule is being computed is passed explicitly, so a subclass
   * whose next instant depends on per-generation state (see `PollingTrigger`'s
   * error backoff) keys that state off the run rather than off `this`.
   */
  protected abstract computeNextFireTime(fromMs: number, run: TriggerRun): number;

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

  /** The run installed by the latest {@link start}, or `undefined` when stopped and drained. */
  protected get currentRun(): TriggerRun | undefined {
    return this._run;
  }

  private async releaseWhenIdle(run: TriggerRun, timeoutMs: number | undefined): Promise<void> {
    const deadline = timeoutMs === undefined ? undefined : this.createStopDeadline(timeoutMs);
    try {
      // A loop, not a single `allSettled`: a chain draining queued ticks may still
      // be adding work when the first snapshot is taken.
      while (run.pending.size > 0) {
        if (deadline === undefined) {
          await Promise.allSettled([...run.pending]);
          continue;
        }
        const outcome = await Promise.race([
          Promise.allSettled([...run.pending]).then(() => "settled" as const),
          deadline.expired,
        ]);
        if (outcome === "expired") {
          this.reportStopTimeout(run, deadline.timeoutMs);
          break;
        }
      }
    } finally {
      deadline?.cancel();
    }

    // Reached on the timeout path too. The abandoned handlers cannot be
    // recalled, but stranding the run as well would leave the trigger reporting
    // `running` with nothing scheduled, and every later `start()` a silent
    // no-op — the caller would have lost the trigger, not just the drain.

    // A `start()` during the drain installed a newer run. Clearing `_run` here
    // would strand it, and emitting `stop` would report a trigger that is
    // actively firing as stopped.
    if (this._run !== run) return;
    this._run = undefined;
    this.safeEmit("stop");
  }

  /**
   * A timer the drain races against, cancelled in the caller's `finally` — an
   * un-cleared one keeps a Node host alive for the length of a deadline that
   * has already been beaten, which is precisely what `stop()` was called to end.
   */
  private createStopDeadline(timeoutMs: number): StopDeadline {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<"expired">((resolve) => {
      timer = setTimeout(() => resolve("expired"), timeoutMs);
      if (this.unrefTimer) {
        (timer as unknown as { unref?: () => void }).unref?.();
      }
    });
    return {
      timeoutMs,
      expired,
      cancel: () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
      },
    };
  }

  /**
   * Reported, not thrown: `stop()` resolves so the caller can finish shutting
   * down, and the count is what says how much work was left behind.
   */
  private reportStopTimeout(run: TriggerRun, timeoutMs: number): void {
    const pending = run.pending.size;
    this.safeEmit(
      "error",
      new TriggerStopTimeoutError(
        `stop() gave up after ${timeoutMs}ms with ${pending} handler invocation(s) ` +
          `still in flight; they were abandoned and are still running.`
      )
    );
    getLogger().warn("Trigger stop deadline expired with handlers still in flight", {
      triggerId: this.id,
      kind: this.kind,
      pending,
      timeoutMs,
    });
  }

  private scheduleAt(run: TriggerRun, targetMs: number): void {
    const remaining = Math.max(0, targetMs - Date.now());
    // Decided HERE, while the wall clock is still trustworthy. Re-deciding it at
    // expiry from `Date.now() < targetMs` cannot tell a chunk apart from a
    // backward clock step, and serves the step as a wait of the same size.
    const truncated = remaining > MAX_TIMER_DELAY_MS;
    const timer = setTimeout(
      () => {
        run.timer = undefined;
        if (!run.active) return;
        // A chunked wait (or an early host timer) lands before the target.
        const shortfall = targetMs - Date.now();
        if (
          shortfall > 0 &&
          (truncated || this.clockDomain === "wall" || shortfall <= EARLY_TIMER_TOLERANCE_MS)
        ) {
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
      nextFireAt = this.computeNextFireTime(scheduledAt, run);
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
    if (this.overlap === "concurrent") {
      // Unbounded by default; a ceiling degrades the excess tick to a skip
      // rather than letting the fan-out grow one invocation per tick forever.
      if (run.inFlight >= this.maxConcurrentFires) {
        this.safeEmit("skip", scheduledAt);
        this.noteSkip(run, scheduledAt);
        return;
      }
    } else if (run.inFlight > 0 || run.queued.length > 0) {
      if (this.overlap === "queue" && run.queued.length < this.maxQueuedFires) {
        this.flushSkipStreak(run);
        run.queued.push(scheduledAt);
        return;
      }
      this.safeEmit("skip", scheduledAt);
      this.noteSkip(run, scheduledAt);
      return;
    }
    this.flushSkipStreak(run);

    // The microtask hop is load-bearing, not ceremony. Called directly,
    // `runTickChain` runs its whole synchronous prefix — the `fire` emit and the
    // handler's own synchronous head — BEFORE `run.pending.add` below, so a
    // `stop()` begun from a `fire` listener (or by the handler itself) would see
    // an empty `pending`, drain instantly, and resolve while that handler was
    // still running. Deferring by one microtask puts all of `runTickChain`
    // behind the registration. The schedule is unaffected: the next tick was
    // already scheduled in `onTick` before this call.
    const chain = Promise.resolve().then(() => this.runTickChain(run, scheduledAt));
    run.pending.add(chain);
    // `catch` before `finally`: `runTickChain` reports handler errors itself,
    // but an `error` LISTENER that throws rejects the chain, and a bare
    // `chain.finally(...)` would surface that as an unhandled rejection —
    // crashing a Node host whose only fault was a noisy listener. `stop()`
    // still awaits `chain` itself through `allSettled`.
    void chain.catch(() => {}).finally(() => run.pending.delete(chain));
  }

  /**
   * Logs the FIRST skip of a contiguous run only. A handler wedged against a
   * 1s period otherwise writes 3,600 identical warnings an hour, indefinitely;
   * the count is reported once by {@link flushSkipStreak} when the run ends.
   */
  private noteSkip(run: TriggerRun, scheduledAt: number): void {
    run.skipStreak += 1;
    if (run.skipStreak > 1) return;
    getLogger().warn("Trigger fire skipped; previous handler still running", {
      triggerId: this.id,
      kind: this.kind,
      scheduledAt,
      overlap: this.overlap,
    });
  }

  /** Reports how long a contiguous run of skips lasted, once it ends. */
  private flushSkipStreak(run: TriggerRun): void {
    const skipped = run.skipStreak;
    run.skipStreak = 0;
    // A lone skip already logged everything there is to say.
    if (skipped < 2) return;
    getLogger().warn("Trigger fire skips ended", {
      triggerId: this.id,
      kind: this.kind,
      skipped,
    });
  }

  /**
   * Runs a tick and then drains queued ticks iteratively — a recursive drain
   * would keep every queued frame alive for the lifetime of the trigger.
   */
  private async runTickChain(run: TriggerRun, first: number): Promise<void> {
    // The chain reaches here one microtask after `dispatch` registered it in
    // `run.pending`, and a `stop()` in that window clears `run.active` but
    // still AWAITS this chain through `releaseWhenIdle` — so without this
    // check the first tick runs anyway, emitting `fire` and invoking the
    // handler with an already-aborted signal. The loop's own `run.active`
    // test is at the bottom, after that first tick has happened.
    //
    // Returning immediately keeps the drain correct: the chain is still in
    // `pending`, so `stop()` still awaits it; it simply resolves at once.
    if (!run.active) return;
    let scheduledAt: number | undefined = first;
    while (scheduledAt !== undefined) {
      run.inFlight += 1;
      try {
        await this.runTick(scheduledAt, run);
      } catch (error) {
        // A tick that failed BECAUSE we stopped it is the expected shape of a
        // graceful `stop()`, not a fault: a handler that forwards its signal
        // rejects with an AbortError, and reporting that on `error` makes every
        // orderly shutdown look like a failure — loudly enough that callers
        // install absorbing `error` listeners, which then swallow the real
        // failures too.
        //
        // Both halves are required. `run.signal.aborted` alone is a question
        // about the RUN, not about this error: once `stop()` aborts, a handler
        // that throws a genuine bug in the same window is indistinguishable
        // from a cancellation and would be filed at `debug` — the same
        // swallowing this branch exists to prevent, just relocated.
        if (run.signal.aborted && isAbortShaped(error, run.signal)) {
          getLogger().debug("Trigger tick aborted during stop", {
            triggerId: this.id,
            kind: this.kind,
            scheduledAt,
            error: error instanceof Error ? error.message : String(error),
          });
        } else {
          this.reportError(error, scheduledAt);
        }
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
