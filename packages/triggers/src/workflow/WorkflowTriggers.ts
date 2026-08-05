/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPorts, WorkflowRunConfig } from "@workglow/task-graph";
import { Workflow } from "@workglow/task-graph";
import type { ITrigger, ITriggerFireContext } from "../trigger/ITrigger";
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
}

/** Options for {@link Workflow.listen}. */
export interface WorkflowListenOptions {
  /** Caller-owned cancellation; aborting it stops every bound trigger. */
  readonly signal?: AbortSignal | undefined;
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
  /** Stops every trigger and resolves once in-flight runs have settled. */
  stop(): Promise<void>;
}

interface TriggerBinding {
  readonly trigger: ITrigger;
  readonly options: WorkflowTriggerOptions;
}

// Prototype methods cannot reach Workflow's private fields, so bindings live
// beside the instance. A WeakMap keeps a discarded workflow collectable.
const workflowBindings = new WeakMap<Workflow, TriggerBinding[]>();
const workflowHandles = new WeakMap<Workflow, ITriggerListenerHandle>();

/** The triggers bound to `workflow` via {@link Workflow.trigger}, in binding order. */
export function getWorkflowTriggers(workflow: Workflow): readonly ITrigger[] {
  return (workflowBindings.get(workflow) ?? []).map((binding) => binding.trigger);
}

declare module "@workglow/task-graph" {
  interface Workflow {
    /**
     * Binds a trigger to this workflow. Bindings accumulate; nothing is
     * scheduled until {@link Workflow.listen} is called.
     */
    trigger(trigger: ITrigger, options?: WorkflowTriggerOptions): Workflow;

    /**
     * Starts every bound trigger and RESOLVES IMMEDIATELY — it does not block
     * until the process is interrupted. Keeping the process alive is the host
     * application's job (a server's own event loop, a `SIGINT` await, a test
     * runner); this method only owns the schedule.
     *
     * Calling it again while already listening returns the same handle rather
     * than starting a second set of timers.
     */
    listen(options?: WorkflowListenOptions): Promise<ITriggerListenerHandle>;

    /** Stops every trigger started by {@link Workflow.listen}. A no-op when not listening. */
    stopListening(): Promise<void>;
  }
}

Workflow.prototype.trigger = function (
  this: Workflow,
  trigger: ITrigger,
  options: WorkflowTriggerOptions = {}
): Workflow {
  if (workflowHandles.has(this)) {
    throw new WorkflowTriggerError(
      "Cannot bind a trigger while the workflow is listening. Call stopListening() first."
    );
  }
  const bindings = workflowBindings.get(this) ?? [];
  bindings.push({ trigger, options });
  workflowBindings.set(this, bindings);
  return this;
};

Workflow.prototype.listen = async function (
  this: Workflow,
  options: WorkflowListenOptions = {}
): Promise<ITriggerListenerHandle> {
  const existing = workflowHandles.get(this);
  if (existing) return existing;

  const bindings = workflowBindings.get(this) ?? [];
  if (bindings.length === 0) {
    throw new WorkflowTriggerError(
      "listen() requires at least one trigger. Bind one with workflow.trigger(...) first."
    );
  }

  for (const binding of bindings) {
    binding.trigger.start(
      (context) => runWorkflowForFire(this, binding, context),
      options.signal ? { signal: options.signal } : {}
    );
  }

  const triggers = bindings.map((binding) => binding.trigger);
  const stop = async (): Promise<void> => {
    await Promise.all(triggers.map((trigger) => trigger.stop()));
    if (workflowHandles.get(this) === handle) workflowHandles.delete(this);
  };
  const handle: ITriggerListenerHandle = {
    triggers,
    stop,
    [Symbol.asyncDispose]: stop,
  };

  workflowHandles.set(this, handle);
  return handle;
};

Workflow.prototype.stopListening = async function (this: Workflow): Promise<void> {
  await workflowHandles.get(this)?.stop();
};

async function runWorkflowForFire(
  workflow: Workflow,
  binding: TriggerBinding,
  context: ITriggerFireContext
): Promise<void> {
  const input = binding.options.input ? await binding.options.input(context) : {};

  // Stopping the trigger must also cancel the run it started, not merely stop
  // scheduling the next one.
  const onAbort = (): void => {
    void workflow.abort();
  };
  context.signal.addEventListener("abort", onAbort, { once: true });
  try {
    await workflow.run(input, binding.options.runConfig);
  } catch (error) {
    // A run cancelled by our own stop() is the expected path, not a failure to
    // report on the trigger's `error` event.
    if (context.signal.aborted) return;
    throw error;
  } finally {
    context.signal.removeEventListener("abort", onAbort);
  }
}
