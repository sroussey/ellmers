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

  private _running = false;
  private _handler: TriggerHandler | undefined;
  private _controller: AbortController | undefined;
  private _signal: AbortSignal | undefined;
  private _externalAbort: (() => void) | undefined;
  private _timer: ReturnType<typeof setTimeout> | undefined;
  private _inFlight = 0;
  private readonly _queued: number[] = [];
  private readonly _pending = new Set<Promise<void>>();

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
  }

  public get running(): boolean {
    return this._running;
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

  public start(handler: TriggerHandler, options: TriggerStartOptions = {}): void {
    // Starting twice is a no-op rather than an error, so a start/start/stop
    // sequence leaves no orphaned timer behind.
    if (this._running) return;
    // An already-aborted caller signal means "do not schedule anything".
    if (options.signal?.aborted) return;

    this._running = true;
    this._handler = handler;
    this._controller = new AbortController();
    this._signal = options.signal
      ? AbortSignal.any([this._controller.signal, options.signal])
      : this._controller.signal;

    if (options.signal) {
      const externalSignal = options.signal;
      const onExternalAbort = (): void => {
        void this.stop();
      };
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      this._externalAbort = () => externalSignal.removeEventListener("abort", onExternalAbort);
    }

    this.scheduleAt(this.computeNextFireTime(Date.now()));
    this.events.emit("start");
  }

  public async stop(): Promise<void> {
    if (!this._running) return;

    this._running = false;
    if (this._timer !== undefined) {
      clearTimeout(this._timer);
      this._timer = undefined;
    }
    this._queued.length = 0;
    this._externalAbort?.();
    this._externalAbort = undefined;
    this._controller?.abort();

    await Promise.allSettled([...this._pending]);

    this._handler = undefined;
    this._controller = undefined;
    this._signal = undefined;
    this.events.emit("stop");
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
   */
  protected async runTick(scheduledAt: number, signal: AbortSignal): Promise<void> {
    await this.invokeHandler({
      triggerId: this.id,
      scheduledAt,
      signal,
      payload: undefined,
    });
  }

  /** Emits `fire` and awaits the registered handler. */
  protected async invokeHandler(context: ITriggerFireContext): Promise<void> {
    const handler = this._handler;
    if (!handler) return;
    this.events.emit("fire", context);
    await handler(context);
  }

  private scheduleAt(targetMs: number): void {
    const remaining = Math.max(0, targetMs - Date.now());
    this._timer = setTimeout(
      () => {
        this._timer = undefined;
        if (!this._running) return;
        // A chunked wait (or an early host timer) lands before the target.
        if (Date.now() < targetMs) {
          this.scheduleAt(targetMs);
          return;
        }
        this.onTick(targetMs);
      },
      Math.min(remaining, MAX_TIMER_DELAY_MS)
    );
  }

  private onTick(scheduledAt: number): void {
    this.scheduleAt(this.computeNextFireTime(scheduledAt));
    this.dispatch(scheduledAt);
  }

  private dispatch(scheduledAt: number): void {
    if (this.overlap !== "concurrent" && (this._inFlight > 0 || this._queued.length > 0)) {
      if (this.overlap === "queue" && this._queued.length < this.maxQueuedFires) {
        this._queued.push(scheduledAt);
        return;
      }
      this.events.emit("skip", scheduledAt);
      getLogger().warn("Trigger fire skipped; previous handler still running", {
        triggerId: this.id,
        kind: this.kind,
        scheduledAt,
        overlap: this.overlap,
      });
      return;
    }

    const chain = this.runTickChain(scheduledAt);
    this._pending.add(chain);
    void chain.finally(() => this._pending.delete(chain));
  }

  /**
   * Runs a tick and then drains queued ticks iteratively — a recursive drain
   * would keep every queued frame alive for the lifetime of the trigger.
   */
  private async runTickChain(first: number): Promise<void> {
    // `stop()` clears the signal only after awaiting the pending chains, so the
    // signal captured here stays valid for every tick in this chain.
    const signal = this._signal;
    if (!signal) return;

    let scheduledAt: number | undefined = first;
    while (scheduledAt !== undefined) {
      this._inFlight += 1;
      try {
        await this.runTick(scheduledAt, signal);
      } catch (error) {
        this.reportError(error, scheduledAt);
      } finally {
        this._inFlight -= 1;
      }
      scheduledAt = this._running ? this._queued.shift() : undefined;
    }
  }

  private reportError(error: unknown, scheduledAt: number): void {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    this.events.emit("error", wrapped);
    getLogger().error("Trigger handler failed", {
      triggerId: this.id,
      kind: this.kind,
      scheduledAt,
      error: wrapped.message,
    });
  }
}
