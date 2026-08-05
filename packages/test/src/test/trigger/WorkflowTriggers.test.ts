/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy } from "@workglow/task-graph";
import { Task, Workflow } from "@workglow/task-graph";
import type { ITriggerListenerHandle } from "@workglow/triggers";
import {
  getWorkflowTriggers,
  IntervalTrigger,
  PollingTrigger,
  WorkflowTriggerError,
} from "@workglow/triggers";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { advanceFakeTimers, flushAsyncWork } from "../helpers/advanceFakeTimers";

const START = Date.UTC(2026, 0, 1, 0, 0, 0);
const PERIOD = 100;

type RecorderInput = { label: string };
type RecorderOutput = { recorded: string };

/** Records every execution so a test can assert what each trigger fire ran with. */
const executions: string[] = [];
let failNextRuns = 0;

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

  override async execute(input: RecorderInput): Promise<RecorderOutput> {
    executions.push(input.label);
    if (failNextRuns > 0) {
      failNextRuns -= 1;
      throw new Error(`run failed for ${input.label}`);
    }
    return { recorded: input.label };
  }
}

function createWorkflow(): Workflow {
  return new Workflow().addTask(RecorderTask, { label: "default" });
}

describe("Workflow trigger bindings", () => {
  beforeEach(() => {
    executions.length = 0;
    failNextRuns = 0;
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("augments the Workflow prototype with lifecycle methods", () => {
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

  test("a fire with no input mapping runs the workflow with its declared defaults", async () => {
    const workflow = createWorkflow();
    workflow.trigger(new IntervalTrigger({ intervalMs: PERIOD }));

    const handle = await workflow.listen();
    await advanceFakeTimers(PERIOD);

    expect(executions).toEqual(["default"]);

    await handle.stop();
  });
});
