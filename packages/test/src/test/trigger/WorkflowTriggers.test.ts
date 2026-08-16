/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy, IExecuteContext, WorkflowRunConfig } from "@workglow/task-graph";
import { Task, Workflow } from "@workglow/task-graph";
import type {
  ITrigger,
  ITriggerListenerHandle,
  TriggerEventListener,
  TriggerEventListeners,
  TriggerEvents,
} from "@workglow/triggers";
import {
  CronTrigger,
  CronUnsatisfiableError,
  getWorkflowTriggers,
  installWorkflowTriggers,
  IntervalTrigger,
  PollingTrigger,
  TriggerConfigurationError,
  WorkflowTriggerError,
} from "@workglow/triggers";
import type { ILogger } from "@workglow/util";
import { EventEmitter, getLogger, ResourceScope, setLogger } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { advanceFakeTimers, flushAsyncWork } from "../helpers/advanceFakeTimers";

const START = Date.UTC(2026, 0, 1, 0, 0, 0);
const PERIOD = 100;

type RecorderInput = { label: string };
type RecorderOutput = { recorded: string };

interface Gate {
  readonly promise: Promise<void>;
  readonly open: () => void;
}

function createGate(): Gate {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Records every execution so a test can assert what each trigger fire ran with. */
const executions: string[] = [];
let failNextRuns = 0;
/**
 * When set, every execution parks on this gate until it opens or its run's
 * signal aborts — which is how a test observes WHICH in-flight run a trigger's
 * `stop()` cancelled.
 */
let holdGate: Gate | undefined;
const completed: string[] = [];
const abortedRuns: string[] = [];
/** Highest number of executions ever in flight at once. */
let peakConcurrency = 0;
let inFlight = 0;

class RecorderTask extends Task<RecorderInput, RecorderOutput> {
  public static override type = "TriggerRecorderTask";
  public static override category = "Test";
  public static override title = "Trigger Recorder";
  public static override description = "Records its input for trigger tests.";
  // Each fire must actually execute; a cached output would hide repeat runs.
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { label: { type: "string", default: "none" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { recorded: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: RecorderInput, context: IExecuteContext): Promise<RecorderOutput> {
    executions.push(input.label);
    inFlight += 1;
    peakConcurrency = Math.max(peakConcurrency, inFlight);
    try {
      if (failNextRuns > 0) {
        failNextRuns -= 1;
        throw new Error(`run failed for ${input.label}`);
      }
      const gate = holdGate;
      if (gate) {
        await new Promise<void>((resolve) => {
          const done = (): void => {
            context.signal.removeEventListener("abort", done);
            resolve();
          };
          context.signal.addEventListener("abort", done, { once: true });
          void gate.promise.then(done);
        });
        if (context.signal.aborted) {
          abortedRuns.push(input.label);
          throw new Error(`aborted ${input.label}`);
        }
      }
      completed.push(input.label);
      return { recorded: input.label };
    } finally {
      inFlight -= 1;
    }
  }
}

function createWorkflow(): Workflow {
  return new Workflow().addTask(RecorderTask, { label: "default" });
}

/**
 * A third-party `ITrigger` whose `stop()` never settles AND which ignores
 * `TriggerStopOptions` entirely — the shape of any implementation written
 * before the option existed. It is why the deadline is applied again around the
 * whole set: forwarding it to each trigger alone would leave this one wedging
 * every sibling on the workflow.
 */
class WedgedTrigger implements ITrigger {
  public readonly kind = "wedged";
  public readonly events = new EventEmitter<TriggerEventListeners>();
  public running = false;

  constructor(public readonly id: string) {}

  public start(): void {
    this.running = true;
  }

  public stop(): Promise<void> {
    return new Promise<void>(() => {});
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
}

/**
 * A trigger whose `stop()` REJECTS. `listenWorkflow`'s stop path reports each
 * rejection through the logger, so this is what puts a logger call on the
 * caller-abort listener's path — where a throw has no caller left to catch it.
 */
class RejectingStopTrigger implements ITrigger {
  public readonly kind = "rejecting-stop";
  public readonly events = new EventEmitter<TriggerEventListeners>();
  public running = false;

  constructor(public readonly id: string) {}

  public start(): void {
    this.running = true;
  }

  public stop(): Promise<void> {
    this.running = false;
    return Promise.reject(new Error("stop boom"));
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
}

interface WarnRecord {
  readonly message: string;
  readonly meta: Record<string, unknown> | undefined;
}

/**
 * Installs a logger that records `warn` calls; returns the sink and a restore fn.
 * Built from scratch rather than spread from the installed logger, whose methods
 * live on a class prototype and would be lost.
 */
function captureWarnings(): { warnings: WarnRecord[]; restore: () => void } {
  const warnings: WarnRecord[] = [];
  const previous = getLogger();
  const noop = (): void => {};
  const logger: ILogger = {
    debug: noop,
    info: noop,
    warn: (message: string, meta?: Record<string, unknown>) => {
      warnings.push({ message, meta });
    },
    error: noop,
    fatal: noop,
    child: () => logger,
    time: noop,
    timeEnd: noop,
    group: noop,
    groupEnd: noop,
  };
  setLogger(logger);
  return { warnings, restore: () => setLogger(previous) };
}

/**
 * Flushes microtasks until `predicate` holds. Serialized runs hand off to each
 * other over several microtask turns, and advancing the clock instead would
 * deliver more fires — which is exactly what these tests are counting.
 */
async function drainUntil(predicate: () => boolean): Promise<void> {
  for (let pass = 0; pass < 50 && !predicate(); pass += 1) {
    await flushAsyncWork();
  }
}

// The fluent methods this suite exercises are opt-in: importing the package
// installs nothing (see TriggerInstall.test.ts). Install once for the file.
installWorkflowTriggers();

describe("Workflow trigger bindings", () => {
  beforeEach(() => {
    executions.length = 0;
    completed.length = 0;
    abortedRuns.length = 0;
    holdGate = undefined;
    failNextRuns = 0;
    peakConcurrency = 0;
    inFlight = 0;
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("installWorkflowTriggers() adds the lifecycle methods to the prototype", () => {
    expect(typeof Workflow.prototype.trigger).toBe("function");
    expect(typeof Workflow.prototype.listen).toBe("function");
    expect(typeof Workflow.prototype.stopListening).toBe("function");
  });

  test("trigger() is chainable and records bindings in order", () => {
    const workflow = createWorkflow();
    const first = new IntervalTrigger({ intervalMs: PERIOD, id: "first" });
    const second = new IntervalTrigger({ intervalMs: PERIOD, id: "second" });

    expect(workflow.trigger(first)).toBe(workflow);
    workflow.trigger(second);

    expect(getWorkflowTriggers(workflow).map((trigger) => trigger.id)).toEqual(["first", "second"]);
  });

  test("bindings are per-workflow, not global", () => {
    const a = createWorkflow();
    const b = createWorkflow();
    a.trigger(new IntervalTrigger({ intervalMs: PERIOD, id: "only-a" }));

    expect(getWorkflowTriggers(a)).toHaveLength(1);
    expect(getWorkflowTriggers(b)).toHaveLength(0);
  });

  test("runs the workflow once per fire with the mapped input", async () => {
    const workflow = createWorkflow();
    const trigger = new IntervalTrigger({ intervalMs: PERIOD });
    workflow.trigger(trigger, {
      input: (context) => ({ label: `fire@${context.scheduledAt - START}` }),
    });

    const handle = await workflow.listen();

    await advanceFakeTimers(PERIOD * 3);
    expect(executions).toEqual(["fire@100", "fire@200", "fire@300"]);

    await handle.stop();
  });

  test("listen() resolves immediately rather than blocking until stopped", async () => {
    const workflow = createWorkflow();
    workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD }));

    let resolved = false;
    const listening = workflow.listen().then((handle) => {
      resolved = true;
      return handle;
    });

    await flushAsyncWork();
    expect(resolved).toBe(true);

    await (await listening).stop();
  });

  test("a polling trigger forwards its payload into the run input", async () => {
    const workflow = createWorkflow();
    const batches = [[], ["x", "y"], []] as string[][];
    let polls = 0;
    workflow.trigger(
      new PollingTrigger<string[]>({
        intervalMs: PERIOD,
        poll: () => batches[polls++]!,
      }),
      { input: (context) => ({ label: (context.payload as string[]).join("+") }) }
    );

    const handle = await workflow.listen();
    await advanceFakeTimers(PERIOD * 3);

    // Only the non-empty poll started a run.
    expect(executions).toEqual(["x+y"]);

    await handle.stop();
  });

  test("multiple triggers on one workflow all drive runs", async () => {
    const workflow = createWorkflow();
    workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD }), {
      input: () => ({ label: "fast" }),
    });
    workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD * 2 }), {
      input: () => ({ label: "slow" }),
    });

    const handle = await workflow.listen();
    await advanceFakeTimers(PERIOD * 2);

    expect(executions.filter((label) => label === "fast")).toHaveLength(2);
    expect(executions.filter((label) => label === "slow")).toHaveLength(1);

    await handle.stop();
  });

  test("genuinely overlapping fires run one at a time instead of colliding", async () => {
    // `overlap: "concurrent"` invokes the handler on every tick regardless of
    // what is in flight, so with a handler slower than the period the fires
    // really do overlap. One Workflow owns one TaskGraph, which refuses to be
    // run re-entrantly, so an unserialized second fire is lost to a
    // "Graph is already running" error on the trigger's `error` event.
    const workflow = createWorkflow();
    const trigger = new IntervalTrigger({ intervalMs: PERIOD, overlap: "concurrent" });
    const errors: Error[] = [];
    trigger.on("error", (error) => errors.push(error));
    workflow.trigger(trigger, {
      input: (context) => ({ label: `fire@${context.scheduledAt - START}` }),
      maxPendingFires: 5,
    });

    const gate = createGate();
    holdGate = gate;
    const handle = await workflow.listen();

    await advanceFakeTimers(PERIOD * 3);
    // Three fires dispatched; only the first is executing.
    expect(executions).toEqual(["fire@100"]);
    expect(peakConcurrency).toBe(1);

    holdGate = undefined;
    gate.open();
    await drainUntil(() => completed.length >= 3);

    expect(executions).toEqual(["fire@100", "fire@200", "fire@300"]);
    expect(completed).toEqual(["fire@100", "fire@200", "fire@300"]);
    // Strictly sequential: no run ever started while another was executing.
    expect(peakConcurrency).toBe(1);
    expect(errors).toEqual([]);

    await handle.stop();
  });

  test("a fire past maxPendingFires is dropped and reported on the error event", async () => {
    const workflow = createWorkflow();
    const trigger = new IntervalTrigger({ intervalMs: PERIOD, overlap: "concurrent" });
    const errors: Error[] = [];
    trigger.on("error", (error) => errors.push(error));
    workflow.trigger(trigger, {
      input: (context) => ({ label: `fire@${context.scheduledAt - START}` }),
      maxPendingFires: 1,
    });

    const gate = createGate();
    holdGate = gate;
    const handle = await workflow.listen();

    await advanceFakeTimers(PERIOD * 3);
    // fire@100 is running and fire@200 is waiting, so fire@300 exceeds the bound.
    expect(executions).toEqual(["fire@100"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(WorkflowTriggerError);
    expect(errors[0]?.message).toContain("maxPendingFires");

    holdGate = undefined;
    gate.open();
    await drainUntil(() => completed.length >= 2);

    // The dropped fire never runs; the bounded one still does.
    expect(executions).toEqual(["fire@100", "fire@200"]);
    expect(errors).toHaveLength(1);

    await handle.stop();
  });

  test("maxPendingFires is validated at bind time", () => {
    // It was the only numeric bound in the package read raw, and it breaks in
    // BOTH directions:
    //
    //   NaN / Infinity — the drop test is `waiting >= limit`, and both
    //   `NaN >= NaN` and `n >= Infinity` are false, so the drop branch is
    //   UNREACHABLE. Every overlapping fire queues instead, each retaining a
    //   chain closure and its captured `input` — the unbounded backlog the
    //   default of 1 exists to prevent, silently reintroduced by a typo.
    //
    //   0 / negative — `0 >= 0` is true, so EVERY overlapping fire is dropped,
    //   and the error message interpolates the bogus limit back at the caller
    //   ("maxPendingFires: 0"), reading like a deliberate configuration.
    //
    // 1.5 is here because a fractional bound is meaningless for a count and
    // the other five bounds reject it; `Number.isInteger` covers all five
    // cases in one test.
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5]) {
      const workflow = createWorkflow();
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });

      expect(() => workflow.trigger(trigger, { maxPendingFires: value })).toThrow(
        TriggerConfigurationError
      );
      expect(() => workflow.trigger(trigger, { maxPendingFires: value })).toThrow(
        /maxPendingFires/
      );
      // Rejected BEFORE the binding is recorded, so a failed bind leaves the
      // workflow exactly as it was and free to bind properly afterwards.
      expect(getWorkflowTriggers(workflow)).toEqual([]);
    }
  });

  test("a valid maxPendingFires still binds, and so does omitting it", () => {
    // Guards the validation against over-rejecting: the point is to catch the
    // five shapes above, not to narrow what callers may legitimately pass.
    const workflow = createWorkflow();
    const bounded = new IntervalTrigger({ intervalMs: PERIOD, id: "bounded" });
    const defaulted = new IntervalTrigger({ intervalMs: PERIOD, id: "defaulted" });
    const explicitlyUndefined = new IntervalTrigger({ intervalMs: PERIOD, id: "undef" });

    workflow.trigger(bounded, { maxPendingFires: 5 });
    workflow.trigger(defaulted);
    workflow.trigger(explicitlyUndefined, { maxPendingFires: undefined });

    expect(getWorkflowTriggers(workflow).map((trigger) => trigger.id)).toEqual([
      "bounded",
      "defaulted",
      "undef",
    ]);
  });

  test("a runConfig carrying a signal is rejected at bind time", () => {
    // `runConfig` is captured ONCE and reused for every fire forever, while an
    // AbortSignal is one-shot: once the caller aborts, every later fire would
    // start a run that is born cancelled while the schedule kept ticking —
    // one error event per period, indefinitely. Rejecting is better than
    // silently dropping it, and better than bridging it per fire (which leaks
    // one composite signal per fire, retained by the long-lived source).
    const workflow = createWorkflow();
    const trigger = new IntervalTrigger({ intervalMs: PERIOD });
    const controller = new AbortController();

    expect(() =>
      workflow.trigger(trigger, {
        runConfig: { signal: controller.signal } as WorkflowRunConfig,
      })
    ).toThrow(WorkflowTriggerError);
    // The message must name the SUPPORTED alternative: a caller reaching for
    // `runConfig.signal` wants to cancel something, and a bare refusal leaves
    // them without the answer.
    expect(() =>
      workflow.trigger(trigger, {
        runConfig: { signal: controller.signal } as WorkflowRunConfig,
      })
    ).toThrow(/listen\(\{ signal \}\)/);
    expect(getWorkflowTriggers(workflow)).toEqual([]);
  });

  test("a runConfig without a signal is still forwarded, and the fire's own signal wins", async () => {
    // The rejection above must not have cost the option its actual job.
    const workflow = createWorkflow();
    const trigger = new IntervalTrigger({ intervalMs: PERIOD });
    const resourceScope = new ResourceScope();
    const runSpy = vi.spyOn(workflow, "run");

    workflow.trigger(trigger, { runConfig: { resourceScope } });
    const handle = await workflow.listen();

    await advanceFakeTimers(PERIOD);
    expect(runSpy).toHaveBeenCalledTimes(1);

    const config = runSpy.mock.calls[0]?.[1];
    expect(config?.resourceScope).toBe(resourceScope);
    // The trigger supplies the run's cancellation, unconditionally — cheap
    // defense against a `runConfig` object mutated after binding.
    const signal = config?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    await handle.stop();
    expect(signal?.aborted).toBe(true);

    runSpy.mockRestore();
  });

  test("a rejecting stop() on caller abort produces no unhandled rejection", async () => {
    // The caller-signal listener stops the triggers from an event handler,
    // where there is no caller left to observe a rejected promise: `stop()`
    // reports its own failures through the logger, and a logger that throws
    // used to turn that into a process-killing unhandledRejection.
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onRejection);
    const previousLogger = getLogger();
    try {
      const workflow = createWorkflow();
      const trigger = new RejectingStopTrigger("rejects-on-stop");
      workflow.trigger(trigger);

      const controller = new AbortController();
      const handle = await workflow.listen({ signal: controller.signal });
      expect(handle.triggers).toHaveLength(1);

      // `stop()` logs each rejected trigger stop at `error`; this logger turns
      // that report into a throw, which is what escapes the listener.
      const noop = (): void => {};
      const throwingLogger: ILogger = {
        debug: noop,
        info: noop,
        warn: noop,
        error: () => {
          throw new Error("logger boom");
        },
        fatal: noop,
        child: () => throwingLogger,
        time: noop,
        timeEnd: noop,
        group: noop,
        groupEnd: noop,
      };
      setLogger(throwingLogger);

      controller.abort();
      await flushAsyncWork();
      setLogger(previousLogger);

      expect(rejections).toEqual([]);
      // And the handle was released, so the workflow is usable again — an
      // abort must not lock `trigger()` out forever.
      expect(() =>
        workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD, id: "after-abort" }))
      ).not.toThrow();
    } finally {
      setLogger(previousLogger);
      process.off("unhandledRejection", onRejection);
    }
  });

  test("one binding's backlog is not charged against another binding's limit", async () => {
    // The counter used to be workflow-global while the limit came from the
    // arriving fire's binding. The fast trigger filled the shared count to 5,
    // and the slow trigger's FIRST fire was then dropped with a message reading
    // "5 fire(s) are already waiting ... (maxPendingFires: 1)" — quoting a
    // limit belonging to a trigger that had never queued anything.
    const workflow = createWorkflow();
    const fast = new IntervalTrigger({ intervalMs: PERIOD, id: "fast", overlap: "concurrent" });
    // Fires once, well after the fast trigger has filled its own backlog.
    const slow = new IntervalTrigger({ intervalMs: PERIOD * 4, id: "slow", overlap: "concurrent" });

    const errors: Error[] = [];
    fast.on("error", (error) => errors.push(error));
    slow.on("error", (error) => errors.push(error));

    workflow.trigger(fast, {
      input: (context) => ({ label: `fast@${context.scheduledAt - START}` }),
      maxPendingFires: 5,
    });
    // Default (1): its own first fire queues, and must not see the fast
    // trigger's backlog at all.
    workflow.trigger(slow, { input: () => ({ label: "slow" }) });

    const gate = createGate();
    holdGate = gate;
    const handle = await workflow.listen();

    await advanceFakeTimers(PERIOD * 4);

    // The fast trigger queued 3 fires behind the running one, under its own
    // limit of 5, and the slow trigger's single fire queued under its own 1.
    expect(executions).toEqual(["fast@100"]);
    expect(
      errors.map((error) => error.message).filter((message) => message.includes("slow"))
    ).toEqual([]);
    expect(errors).toEqual([]);

    holdGate = undefined;
    gate.open();
    await drainUntil(() => completed.length >= 5);

    expect(completed).toContain("slow");
    expect(errors).toEqual([]);

    await handle.stop();
  });

  test("a dropped fire names the trigger it came from", async () => {
    const workflow = createWorkflow();
    const trigger = new IntervalTrigger({
      intervalMs: PERIOD,
      id: "chatty",
      overlap: "concurrent",
    });
    const errors: Error[] = [];
    trigger.on("error", (error) => errors.push(error));
    workflow.trigger(trigger, {
      input: (context) => ({ label: `fire@${context.scheduledAt - START}` }),
      maxPendingFires: 1,
    });

    const gate = createGate();
    holdGate = gate;
    const handle = await workflow.listen();

    await advanceFakeTimers(PERIOD * 3);

    expect(errors).toHaveLength(1);
    // Trigger and count in one message, so the quoted limit can never belong to
    // a different trigger than the backlog.
    expect(errors[0]?.message).toContain('trigger "chatty"');
    expect(errors[0]?.message).toContain("1 fire(s) from that trigger");
    expect(errors[0]?.message).toContain("maxPendingFires: 1");

    holdGate = undefined;
    gate.open();
    await drainUntil(() => completed.length >= 2);
    await handle.stop();
  });

  test("stopListening() halts further runs", async () => {
    const workflow = createWorkflow();
    workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD }), {
      input: () => ({ label: "tick" }),
    });

    await workflow.listen();
    await advanceFakeTimers(PERIOD * 2);
    expect(executions).toHaveLength(2);

    await workflow.stopListening();
    await advanceFakeTimers(PERIOD * 5);
    expect(executions).toHaveLength(2);
  });

  test("stopListening() without listening is a no-op", async () => {
    const workflow = createWorkflow();
    await expect(workflow.stopListening()).resolves.toBeUndefined();
  });

  test("a rejecting run does not stop the trigger", async () => {
    const workflow = createWorkflow();
    const trigger = new IntervalTrigger({ intervalMs: PERIOD });
    const errors: Error[] = [];
    trigger.on("error", (error) => errors.push(error));
    workflow.trigger(trigger, { input: () => ({ label: "risky" }) });

    failNextRuns = 1;
    const handle = await workflow.listen();

    await advanceFakeTimers(PERIOD * 3);

    expect(executions).toHaveLength(3);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(trigger.running).toBe(true);

    await handle.stop();
  });

  test("await using disposes the handle and stops the triggers", async () => {
    const workflow = createWorkflow();
    const trigger = new IntervalTrigger({ intervalMs: PERIOD });
    workflow.trigger(trigger, { input: () => ({ label: "scoped" }) });

    {
      await using handle = await workflow.listen();
      expect(handle.triggers).toEqual([trigger]);
      await advanceFakeTimers(PERIOD * 2);
      expect(executions).toHaveLength(2);
    }

    expect(trigger.running).toBe(false);
    await advanceFakeTimers(PERIOD * 3);
    expect(executions).toHaveLength(2);
  });

  test("listen() twice returns the same handle instead of double-scheduling", async () => {
    const workflow = createWorkflow();
    workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD }), {
      input: () => ({ label: "once" }),
    });

    const first: ITriggerListenerHandle = await workflow.listen();
    const second: ITriggerListenerHandle = await workflow.listen();
    expect(second).toBe(first);

    await advanceFakeTimers(PERIOD * 2);
    expect(executions).toHaveLength(2);

    await first.stop();
  });

  test("listen() with no bound trigger throws a typed error", async () => {
    const workflow = createWorkflow();
    await expect(workflow.listen()).rejects.toBeInstanceOf(WorkflowTriggerError);
  });

  test("binding a trigger while listening throws", async () => {
    const workflow = createWorkflow();
    workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD }));
    const handle = await workflow.listen();

    expect(() => workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD }))).toThrow(
      WorkflowTriggerError
    );

    await handle.stop();
    // Once stopped, binding is allowed again.
    expect(() => workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD }))).not.toThrow();
  });

  test("binding the same trigger twice to one workflow throws", () => {
    // Not catchable by a `running` check: neither binding is running yet. One
    // `ITrigger` holds one handler, so the second `start()` is a no-op and the
    // second binding's `input` mapper would never run.
    const workflow = createWorkflow();
    const trigger = new IntervalTrigger({ intervalMs: PERIOD, id: "shared" });
    workflow.trigger(trigger);

    expect(() => workflow.trigger(trigger, { input: () => ({ label: "never" }) })).toThrow(
      WorkflowTriggerError
    );
    expect(() => workflow.trigger(trigger)).toThrow(/shared/);
    // The rejected binding was not recorded.
    expect(getWorkflowTriggers(workflow)).toEqual([trigger]);
  });

  test("listen() with a trigger already running for another workflow throws", async () => {
    const a = createWorkflow();
    const b = createWorkflow();
    const shared = new IntervalTrigger({ intervalMs: PERIOD, id: "shared" });
    a.trigger(shared, { input: () => ({ label: "a" }) });
    b.trigger(shared, { input: () => ({ label: "b" }) });

    const handleA = await a.listen();
    await expect(b.listen()).rejects.toBeInstanceOf(WorkflowTriggerError);

    // Rejected BEFORE any state was touched, so b is unchanged and still
    // bindable — the point of checking ahead of the handle registration.
    expect(() => b.trigger(new IntervalTrigger({ intervalMs: PERIOD, id: "other" }))).not.toThrow();

    await handleA.stop();
  });

  test("a rejected listen() leaves the other workflow's schedule intact", async () => {
    // Previously b.listen() resolved with a handle listing the shared trigger
    // while the handler stayed a's — and `b.stopListening()` then killed a's
    // schedule, from a workflow that had never run once.
    const a = createWorkflow();
    const b = createWorkflow();
    const shared = new IntervalTrigger({ intervalMs: PERIOD, id: "shared" });
    a.trigger(shared, { input: () => ({ label: "a" }) });
    b.trigger(shared, { input: () => ({ label: "b" }) });

    const handleA = await a.listen();
    await expect(b.listen()).rejects.toBeInstanceOf(WorkflowTriggerError);

    await b.stopListening();
    expect(shared.running).toBe(true);

    await advanceFakeTimers(PERIOD * 2);
    expect(executions).toEqual(["a", "a"]);

    await handleA.stop();
  });

  test("a trigger is bindable again once the workflow using it has stopped", async () => {
    const a = createWorkflow();
    const b = createWorkflow();
    const shared = new IntervalTrigger({ intervalMs: PERIOD, id: "shared" });
    a.trigger(shared, { input: () => ({ label: "a" }) });
    b.trigger(shared, { input: () => ({ label: "b" }) });

    await (await a.listen()).stop();
    const handleB = await b.listen();

    await advanceFakeTimers(PERIOD);
    expect(executions).toEqual(["b"]);

    await handleB.stop();
  });

  test("a caller signal passed to listen() stops every trigger", async () => {
    const workflow = createWorkflow();
    const trigger = new IntervalTrigger({ intervalMs: PERIOD });
    workflow.trigger(trigger, { input: () => ({ label: "abortable" }) });
    const controller = new AbortController();

    await workflow.listen({ signal: controller.signal });
    await advanceFakeTimers(PERIOD);
    expect(executions).toHaveLength(1);

    controller.abort();
    await flushAsyncWork();

    expect(trigger.running).toBe(false);
    await advanceFakeTimers(PERIOD * 3);
    expect(executions).toHaveLength(1);
  });

  test("a trigger whose start() throws leaves no started triggers and no handle", async () => {
    const workflow = createWorkflow();
    const healthy = new IntervalTrigger({ intervalMs: PERIOD, id: "healthy" });
    // Parses fine; February has no 30th, so it fails on the first schedule.
    const doomed = new CronTrigger({ expression: "0 0 30 2 *", id: "doomed" });
    workflow.trigger(healthy, { input: () => ({ label: "healthy" }) });
    workflow.trigger(doomed);

    await expect(workflow.listen()).rejects.toBeInstanceOf(CronUnsatisfiableError);

    expect(healthy.running).toBe(false);
    await advanceFakeTimers(PERIOD * 3);
    expect(executions).toEqual([]);

    // No handle was registered, so the workflow is still bindable/listenable.
    expect(() => workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD }))).not.toThrow();
  });

  test("stopping a trigger cancels the run that trigger started", async () => {
    // The trigger's signal is forwarded as `runConfig.signal`, so it cancels
    // exactly the run this fire started — rather than `workflow.abort()`, which
    // trips the workflow's single current-run controller and would cancel
    // whichever run happens to be current, no matter who started it.
    const workflow = createWorkflow();
    const trigger = new IntervalTrigger({ intervalMs: PERIOD, id: "owner" });
    workflow.trigger(trigger, { input: () => ({ label: "owned" }) });

    const handle = await workflow.listen();
    const gate = createGate();
    holdGate = gate;

    await advanceFakeTimers(PERIOD);
    expect(executions).toEqual(["owned"]);
    expect(abortedRuns).toEqual([]);

    const stopping = trigger.stop();
    await flushAsyncWork();
    expect(abortedRuns).toEqual(["owned"]);
    expect(completed).toEqual([]);

    holdGate = undefined;
    gate.open();
    await stopping;

    // The cancellation is the expected path, not an error to report.
    expect(trigger.running).toBe(false);
    await handle.stop();
  });

  test("a second trigger keeps running when the first one is stopped", async () => {
    const workflow = createWorkflow();
    const first = new IntervalTrigger({ intervalMs: PERIOD * 4, id: "first" });
    const second = new IntervalTrigger({ intervalMs: PERIOD, id: "second" });
    workflow.trigger(first, { input: () => ({ label: "first" }) });
    workflow.trigger(second, { input: () => ({ label: "second" }) });

    const handle = await workflow.listen();
    await advanceFakeTimers(PERIOD * 4);
    expect(executions).toContain("first");
    expect(executions.filter((label) => label === "second")).toHaveLength(4);

    await first.stop();
    executions.length = 0;

    await advanceFakeTimers(PERIOD * 4);
    expect(executions).not.toContain("first");
    expect(executions.filter((label) => label === "second")).toHaveLength(4);
    expect(second.running).toBe(true);

    await handle.stop();
  });

  test("a caller signal abort releases the handle so the workflow can listen again", async () => {
    const workflow = createWorkflow();
    workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD }), {
      input: () => ({ label: "before" }),
    });
    const controller = new AbortController();

    await workflow.listen({ signal: controller.signal });
    await advanceFakeTimers(PERIOD);
    expect(executions).toEqual(["before"]);

    controller.abort();
    await flushAsyncWork();

    // The handle must be gone, or binding stays locked and listen() keeps
    // handing back a stale handle whose triggers are all dead.
    expect(() =>
      workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD }), {
        input: () => ({ label: "after" }),
      })
    ).not.toThrow();

    const handle = await workflow.listen();
    await advanceFakeTimers(PERIOD);
    expect(executions).toContain("after");

    await handle.stop();
  });

  describe("an already-aborted listen() signal", () => {
    test("rejects instead of returning an inert handle", async () => {
      // The old path returned a handle that had already been removed from the
      // registry and whose triggers were never scheduled — a listen() that
      // looked successful and did nothing.
      const workflow = createWorkflow();
      const trigger = new IntervalTrigger({ intervalMs: PERIOD });
      workflow.trigger(trigger, { input: () => ({ label: "never" }) });

      await expect(workflow.listen({ signal: AbortSignal.abort() })).rejects.toBeInstanceOf(Error);

      expect(trigger.running).toBe(false);
      await advanceFakeTimers(PERIOD * 3);
      expect(executions).toEqual([]);
    });

    test("leaves the workflow free to bind and listen again", async () => {
      // Checked before any state is touched, so the binding lock was never
      // taken and the handle registry was never written.
      const workflow = createWorkflow();
      workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD }), {
        input: () => ({ label: "first" }),
      });

      await expect(workflow.listen({ signal: AbortSignal.abort() })).rejects.toBeInstanceOf(Error);

      expect(() =>
        workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD, id: "later" }), {
          input: () => ({ label: "later" }),
        })
      ).not.toThrow();

      const handle = await workflow.listen();
      await advanceFakeTimers(PERIOD);
      expect(executions).toContain("later");

      await handle.stop();
    });
  });

  describe("stop deadline", () => {
    test("listen({ stopTimeoutMs }) bounds stop() even when a trigger ignores the option", async () => {
      const { warnings, restore } = captureWarnings();
      try {
        const workflow = createWorkflow();
        const wedged = new WedgedTrigger("wedged-1");
        const healthy = new IntervalTrigger({ intervalMs: PERIOD, id: "healthy" });
        workflow.trigger(wedged);
        workflow.trigger(healthy, { input: () => ({ label: "healthy" }) });

        const handle = await workflow.listen({ stopTimeoutMs: PERIOD * 5 });
        await advanceFakeTimers(PERIOD);
        expect(executions).toContain("healthy");

        const stopping = handle.stop();
        await advanceFakeTimers(PERIOD * 5);
        await stopping;

        // The sibling actually stopped rather than being held hostage.
        expect(healthy.running).toBe(false);
        const timedOut = warnings.find(
          (warning) => warning.message === "Timed out stopping workflow triggers"
        );
        expect(timedOut?.meta?.triggerIds).toEqual(["wedged-1"]);

        // The handle was released, so binding and listening are possible again.
        expect(() =>
          workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD, id: "after" }))
        ).not.toThrow();
      } finally {
        restore();
      }
    });

    test("stop({ timeoutMs }) overrides the listen() default", async () => {
      const { warnings, restore } = captureWarnings();
      try {
        const workflow = createWorkflow();
        workflow.trigger(new WedgedTrigger("wedged-2"));

        const handle = await workflow.listen();
        const stopping = handle.stop({ timeoutMs: PERIOD * 2 });
        await advanceFakeTimers(PERIOD * 2);
        await stopping;

        expect(
          warnings.some((warning) => warning.message === "Timed out stopping workflow triggers")
        ).toBe(true);
      } finally {
        restore();
      }
    });

    test("a set of triggers that all stop cleanly reports nothing", async () => {
      const { warnings, restore } = captureWarnings();
      try {
        const workflow = createWorkflow();
        workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD, id: "a" }), {
          input: () => ({ label: "a" }),
        });
        workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD, id: "b" }), {
          input: () => ({ label: "b" }),
        });

        const handle = await workflow.listen({ stopTimeoutMs: PERIOD * 5 });
        await advanceFakeTimers(PERIOD);
        await handle.stop();

        expect(
          warnings.some((warning) => warning.message === "Timed out stopping workflow triggers")
        ).toBe(false);
        // The deadline timer is cleared once the drain wins the race.
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        restore();
      }
    });
  });

  test("a fire with no input mapping runs the workflow with its declared defaults", async () => {
    const workflow = createWorkflow();
    workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD }));

    const handle = await workflow.listen();
    await advanceFakeTimers(PERIOD);

    expect(executions).toEqual(["default"]);

    await handle.stop();
  });
});
