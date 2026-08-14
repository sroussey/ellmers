/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPorts, WorkflowRunConfig } from "@workglow/task-graph";
import { Workflow } from "@workglow/task-graph";
import { getLogger } from "@workglow/util";
import type { ITrigger, ITriggerFireContext, TriggerStopOptions } from "../trigger/ITrigger";
import { WorkflowTriggerError } from "../trigger/TriggerError";

/** Options for a single {@link Workflow.trigger} binding. */
export interface WorkflowTriggerOptions {
  /**
   * Maps a fire into the workflow's run input. Defaults to an empty object —
   * a trigger that only needs to start the workflow passes nothing.
   *
   * A polling trigger's poll result arrives as `context.payload`, so
   * `input: (ctx) => ({ items: ctx.payload })` is the usual shape.
   */
  readonly input?:
    | ((context: ITriggerFireContext) => Partial<DataPorts> | Promise<Partial<DataPorts>>)
    | undefined;
  /** Run configuration forwarded to {@link Workflow.run} on every fire. */
  readonly runConfig?: WorkflowRunConfig | undefined;
  /**
   * How many fires may wait for the workflow's current run before one is
   * dropped. Defaults to `1`.
   *
   * One `Workflow` owns one task graph, which can only be running once, so
   * fires against a workflow are run one at a time no matter what overlap
   * policy the trigger uses. This is the bound on that backlog: a fire arriving
   * past it is dropped and reported on the trigger's `error` event rather than
   * queued forever behind a handler that cannot keep up.
   */
  readonly maxPendingFires?: number | undefined;
}

/** Options for {@link Workflow.listen}. */
export interface WorkflowListenOptions {
  /**
   * Caller-owned cancellation; aborting it stops every bound trigger.
   *
   * An ALREADY-aborted signal makes `listen()` reject instead of handing back
   * an inert handle: nothing would have been scheduled, so returning normally
   * reports a success that never happened.
   */
  readonly signal?: AbortSignal | undefined;
  /**
   * Default deadline for {@link ITriggerListenerHandle.stop}, in milliseconds.
   * Unbounded by default; see {@link TriggerStopOptions.timeoutMs}.
   *
   * Forwarded to each trigger's own `stop()` AND applied again around the whole
   * set, because a trigger is an interface: a third-party `ITrigger` that
   * ignores the option would otherwise wedge `handle.stop()`,
   * `workflow.stopListening()` and an `await using` scope exit for every other
   * trigger bound to this workflow.
   */
  readonly stopTimeoutMs?: number | undefined;
}

/**
 * Handle returned by {@link Workflow.listen}.
 *
 * It is an `AsyncDisposable`, so `await using handle = await wf.listen()` stops
 * the triggers when the scope exits.
 */
export interface ITriggerListenerHandle extends AsyncDisposable {
  /** The triggers this handle started, in binding order. */
  readonly triggers: readonly ITrigger[];
  /**
   * Stops every trigger and resolves once in-flight runs have settled.
   *
   * Pass {@link TriggerStopOptions.timeoutMs} (or `stopTimeoutMs` on
   * {@link Workflow.listen}) to bound that wait; unbounded by default, so a
   * handler that never settles never lets this resolve.
   */
  stop(options?: TriggerStopOptions): Promise<void>;
}

interface TriggerBinding {
  readonly trigger: ITrigger;
  readonly options: WorkflowTriggerOptions;
}

/** Backlog bound applied when a binding does not set {@link WorkflowTriggerOptions.maxPendingFires}. */
const DEFAULT_MAX_PENDING_FIRES = 1;

// Prototype methods cannot reach Workflow's private fields, so bindings live
// beside the instance. A WeakMap keeps a discarded workflow collectable.
const workflowBindings = new WeakMap<Workflow, TriggerBinding[]>();
const workflowHandles = new WeakMap<Workflow, ITriggerListenerHandle>();
/**
 * Tail of the serialized run chain per workflow, and the number of fires
 * waiting on it. See {@link runWorkflowForFire}.
 */
const workflowRunChains = new WeakMap<Workflow, Promise<void>>();
const workflowPendingFires = new WeakMap<Workflow, number>();

/**
 * Resolves what `settling` resolved to, or `undefined` once `timeoutMs` passes.
 *
 * `settling` is an `allSettled`, so it never rejects and `undefined` is
 * unambiguously the deadline. The timer is cleared in `finally` — an
 * un-cleared one keeps a Node host alive past the shutdown it was timing.
 */
async function settleWithin<T>(settling: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      settling,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The triggers bound to `workflow` via {@link Workflow.trigger}, in binding order. */
export function getWorkflowTriggers(workflow: Workflow): readonly ITrigger[] {
  return (workflowBindings.get(workflow) ?? []).map((binding) => binding.trigger);
}

/**
 * These three methods exist only after {@link installWorkflowTriggers} has run
 * — importing this package no longer patches the prototype. TypeScript cannot
 * express that, so the augmentation declares them unconditionally and an app
 * that never installs them gets a `TypeError` the compiler did not warn about.
 * `workglow/auto-bootstrap` installs them; the free functions
 * ({@link bindWorkflowTrigger}, {@link listenWorkflow},
 * {@link stopWorkflowListening}) need no install at all.
 */
declare module "@workglow/task-graph" {
  interface Workflow {
    /**
     * Binds a trigger to this workflow. Bindings accumulate; nothing is
     * scheduled until {@link Workflow.listen} is called.
     *
     * Returns `this`, not `Workflow`: a declared return type would collapse a
     * `Workflow<Input, Output>` to the default `Workflow<DataPorts, DataPorts>`
     * on the first chained call and lose both port types.
     */
    trigger(trigger: ITrigger, options?: WorkflowTriggerOptions): this;

    /**
     * Starts every bound trigger and RESOLVES IMMEDIATELY — it does not block
     * until the process is interrupted. Keeping the process alive is the host
     * application's job (a server's own event loop, a `SIGINT` await, a test
     * runner); this method only owns the schedule.
     *
     * Calling it again while already listening returns the same handle rather
     * than starting a second set of timers.
     *
     * @throws the signal's abort reason when `options.signal` is already
     *   aborted — checked before any state is touched, so the workflow is left
     *   exactly as it was and stays free to bind and listen later.
     */
    listen(options?: WorkflowListenOptions): Promise<ITriggerListenerHandle>;

    /**
     * Stops every trigger started by {@link Workflow.listen}. A no-op when not
     * listening. Bounded only if `listen()` was given a `stopTimeoutMs`.
     */
    stopListening(): Promise<void>;
  }
}

/**
 * Binds `trigger` to `workflow`. The free-function form of
 * {@link Workflow.trigger}, and the one that always exists: the method is only
 * present after {@link installWorkflowTriggers}.
 *
 * Returns the workflow it was given, generically, so a chain preserves
 * `Workflow<Input, Output>` rather than collapsing to the defaults.
 */
export function bindWorkflowTrigger<W extends Workflow>(
  workflow: W,
  trigger: ITrigger,
  options: WorkflowTriggerOptions = {}
): W {
  if (workflowHandles.has(workflow)) {
    throw new WorkflowTriggerError(
      "Cannot bind a trigger while the workflow is listening. Call stopListening() first."
    );
  }
  const bindings = workflowBindings.get(workflow) ?? [];
  bindings.push({ trigger, options });
  workflowBindings.set(workflow, bindings);
  return workflow;
}

/**
 * Starts every trigger bound to `workflow`. The free-function form of
 * {@link Workflow.listen}; see that declaration for the semantics.
 */
export async function listenWorkflow(
  workflow: Workflow,
  options: WorkflowListenOptions = {}
): Promise<ITriggerListenerHandle> {
  // FIRST, before the handle lookup and before any state is touched. An
  // already-aborted signal starts nothing (`BaseTrigger.start` bails on one),
  // so the old path returned a handle that had already been removed from
  // `workflowHandles` and whose triggers were never scheduled: a listen() that
  // looked successful and was inert.
  options.signal?.throwIfAborted();

  const existing = workflowHandles.get(workflow);
  if (existing) return existing;

  const bindings = workflowBindings.get(workflow) ?? [];
  if (bindings.length === 0) {
    throw new WorkflowTriggerError(
      "listen() requires at least one trigger. Bind one with workflow.trigger(...) first."
    );
  }

  const triggers = bindings.map((binding) => binding.trigger);
  let detachAbort: (() => void) | undefined;

  const releaseHandle = (): void => {
    detachAbort?.();
    detachAbort = undefined;
    if (workflowHandles.get(workflow) === handle) workflowHandles.delete(workflow);
  };

  const stop = async (stopOptions: TriggerStopOptions = {}): Promise<void> => {
    const timeoutMs = stopOptions.timeoutMs ?? options.stopTimeoutMs;
    const triggerStopOptions: TriggerStopOptions = timeoutMs === undefined ? {} : { timeoutMs };

    // Which triggers are still draining, so an expiry can name them.
    const outstanding = new Set(triggers);
    // `allSettled`, not `all`: a trigger whose stop rejects must not leave the
    // rest of them scheduling forever. The `async` wrapper matters too — an
    // `ITrigger` whose `stop()` throws synchronously would otherwise take the
    // whole `map` down before a single sibling was asked to stop.
    const settling = Promise.allSettled(
      triggers.map(async (trigger) => {
        try {
          await trigger.stop(triggerStopOptions);
        } finally {
          outstanding.delete(trigger);
        }
      })
    );

    const results =
      timeoutMs === undefined ? await settling : await settleWithin(settling, timeoutMs);

    // Released either way: leaving the handle installed after a timed-out stop
    // locks `workflow.trigger(...)` forever and makes `listen()` keep handing
    // back triggers that are on their way out.
    releaseHandle();

    if (results === undefined) {
      getLogger().warn("Timed out stopping workflow triggers", {
        timeoutMs,
        triggerIds: [...outstanding].map((trigger) => trigger.id),
      });
      return;
    }
    for (const result of results) {
      if (result.status === "rejected") {
        getLogger().error("Trigger failed to stop", { error: String(result.reason) });
      }
    }
  };
  const handle: ITriggerListenerHandle = {
    triggers,
    stop,
    // `AsyncDisposable` passes no arguments, so a scope exit uses the listen()
    // default rather than picking up whatever the runtime hands the method.
    [Symbol.asyncDispose]: () => stop(),
  };

  // Registered BEFORE the triggers start, so the rollback path below (and a
  // caller-signal abort) can always find the handle to release.
  workflowHandles.set(workflow, handle);

  if (options.signal) {
    const signal = options.signal;
    // Each trigger already stops itself on this signal, but the HANDLE also has
    // to go: otherwise an aborted listen() leaves `workflow.trigger(...)`
    // throwing forever and a later listen() returning dead triggers.
    const onAbort = (): void => {
      void stop();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    detachAbort = () => signal.removeEventListener("abort", onAbort);
  }

  const started: ITrigger[] = [];
  try {
    for (const binding of bindings) {
      binding.trigger.start(
        (context) => runWorkflowForFire(workflow, binding, context),
        options.signal ? { signal: options.signal } : {}
      );
      started.push(binding.trigger);
    }
  } catch (error) {
    // A `start()` can throw (an unsatisfiable cron, say). Leaving the earlier
    // triggers running would drive the workflow forever with no handle to stop
    // them through.
    await Promise.allSettled(started.map((trigger) => trigger.stop()));
    releaseHandle();
    throw error;
  }

  return handle;
}

/**
 * Stops every trigger {@link listenWorkflow} started for `workflow`. The
 * free-function form of {@link Workflow.stopListening}; a no-op when the
 * workflow is not listening.
 */
export async function stopWorkflowListening(workflow: Workflow): Promise<void> {
  await workflowHandles.get(workflow)?.stop();
}

/**
 * Installs `trigger()` / `listen()` / `stopListening()` on `Workflow.prototype`,
 * so the fluent form in this package's README works.
 *
 * **Importing this package does not call it.** A module body that patched a
 * foreign prototype would make every entry point re-exporting it side-effectful,
 * and the meta-package `workglow` re-exports it from a barrel that also reaches
 * `@workglow/duckdb`, `postgres`, `sqlite`, `mcp`, `storage`, `task-graph` and
 * `util` — none of which declare `sideEffects` at all, so a bundler must keep
 * every one of them once the barrel cannot be elided. Naming the barrel in
 * `sideEffects` does not help: the flag is consulted per package, and those
 * dependencies have already forfeited the claim. The patch therefore has to be
 * something a consumer asks for.
 *
 * `workglow/auto-bootstrap` calls it, so the batteries-included path is
 * unchanged. Everyone else either calls this once at startup, or uses
 * {@link bindWorkflowTrigger} / {@link listenWorkflow} /
 * {@link stopWorkflowListening} directly and never patches anything.
 *
 * Idempotent, and cheap to call defensively: it returns early once the methods
 * are own properties of the prototype.
 */
export function installWorkflowTriggers(): void {
  if (Object.prototype.hasOwnProperty.call(Workflow.prototype, "trigger")) return;

  Workflow.prototype.trigger = function (
    this: Workflow,
    trigger: ITrigger,
    options?: WorkflowTriggerOptions
  ): Workflow {
    return bindWorkflowTrigger(this, trigger, options);
  };

  Workflow.prototype.listen = function (
    this: Workflow,
    options?: WorkflowListenOptions
  ): Promise<ITriggerListenerHandle> {
    return listenWorkflow(this, options);
  };

  Workflow.prototype.stopListening = function (this: Workflow): Promise<void> {
    return stopWorkflowListening(this);
  };
}

/**
 * Runs the workflow for one fire, serialized against every other fire on the
 * SAME workflow.
 *
 * A `Workflow` owns exactly one `TaskGraph`, and a graph refuses to be run
 * re-entrantly, so two fires landing on one workflow at once — two triggers
 * whose periods share a boundary, or one trigger with `overlap: "concurrent"`
 * and a handler slower than its period — would lose the second fire to a
 * "Graph is already running" error. Deriving a fresh graph per fire is not an
 * option: `TaskGraph` has no clone, `toJSON` cannot carry closures, attached
 * caches, or user-attached task listeners, and a copy would break the identity
 * the trigger bindings and `workflow.abort()` are keyed on.
 */
async function runWorkflowForFire(
  workflow: Workflow,
  binding: TriggerBinding,
  context: ITriggerFireContext
): Promise<void> {
  const input = binding.options.input ? await binding.options.input(context) : {};
  const predecessor = workflowRunChains.get(workflow);

  if (predecessor !== undefined) {
    const limit = binding.options.maxPendingFires ?? DEFAULT_MAX_PENDING_FIRES;
    const waiting = workflowPendingFires.get(workflow) ?? 0;
    if (waiting >= limit) {
      // Thrown rather than dropped in silence: this is the one place the old
      // "Graph is already running" failure was observable, and a backlog the
      // workflow cannot work off is worth reporting on the `error` event.
      throw new WorkflowTriggerError(
        `Dropped a trigger fire scheduled for ${new Date(context.scheduledAt).toISOString()}: ` +
          `${waiting} fire(s) are already waiting for this workflow's run to finish ` +
          `(maxPendingFires: ${limit}).`
      );
    }
    workflowPendingFires.set(workflow, waiting + 1);
  }

  const chain = (async (): Promise<void> => {
    if (predecessor !== undefined) {
      // `catch`, not a bare await: a fire whose run rejected must not take the
      // fires queued behind it down with it.
      await predecessor.catch(() => {});
      workflowPendingFires.set(workflow, (workflowPendingFires.get(workflow) ?? 1) - 1);
      // The wait can outlast the trigger. A fire that queued behind a slow run
      // must not start a new one after `stop()`.
      if (context.signal.aborted) return;
    }
    // Forward the trigger's signal into the run itself rather than calling
    // `workflow.abort()`: that aborts the workflow's CURRENT run, which — with
    // two triggers bound to one workflow — is whichever run started last, so
    // stopping trigger A would cancel trigger B's in-flight run and leave A's own
    // older run going. A per-run signal cancels exactly the run this fire started.
    await workflow.run(input, { ...binding.options.runConfig, signal: context.signal });
  })();

  workflowRunChains.set(workflow, chain);

  try {
    await chain;
  } catch (error) {
    // A run cancelled by our own stop() is the expected path, not a failure to
    // report on the trigger's `error` event.
    if (context.signal.aborted) return;
    throw error;
  } finally {
    // Identity check: a later fire may already have claimed the tail.
    if (workflowRunChains.get(workflow) === chain) workflowRunChains.delete(workflow);
  }
}
