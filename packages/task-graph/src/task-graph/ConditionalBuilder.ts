/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid4 } from "@workglow/util";
import type { ConditionFn } from "../task/ConditionalTask";
import { ConditionalTask } from "../task/ConditionalTask";
import type { ITask, ITaskConstructor } from "../task/ITask";
import { WorkflowError } from "../task/TaskError";
import type { DataPorts, TaskConfig, TaskInput } from "../task/TaskTypes";
import { Dataflow, DATAFLOW_ALL_PORTS } from "./Dataflow";
import type { Workflow } from "./Workflow";
import { getLastTask } from "./WorkflowPipe";

/**
 * Fluent builder for constructing a {@link ConditionalTask} with a
 * canonical then/else shape. Created by {@link Workflow.if} and closed via
 * {@link ConditionalBuilder.endIf}. Each arm accepts a single task class
 * (with optional input/config), which the builder instantiates and wires
 * from the conditional's matching output port.
 *
 * Usage:
 *
 * ```ts
 * workflow
 *   .if((input) => input.kind === "text")
 *   .then(TextTask)
 *   .else(ImageTask)
 *   .endIf();
 * ```
 */
export class ConditionalBuilder {
  private thenSpec: BranchTaskSpec | undefined;
  private elseSpec: BranchTaskSpec | undefined;

  constructor(
    private readonly workflow: Workflow,
    private readonly condition: ConditionFn<TaskInput>
  ) {}

  /**
   * Register the task that runs when the condition matches. Accepts the
   * same (taskClass, input?, config?) triple as {@link Workflow.addTask}.
   */
  public then<I extends DataPorts, O extends DataPorts, C extends TaskConfig<I> = TaskConfig<I>>(
    taskClass: ITaskConstructor<I, O, C>,
    input?: Partial<I>,
    config?: Partial<C>
  ): this {
    this.thenSpec = { taskClass, input, config };
    return this;
  }

  /**
   * Register the task that runs when the condition does not match. Optional.
   */
  public else<I extends DataPorts, O extends DataPorts, C extends TaskConfig<I> = TaskConfig<I>>(
    taskClass: ITaskConstructor<I, O, C>,
    input?: Partial<I>,
    config?: Partial<C>
  ): this {
    this.elseSpec = { taskClass, input, config };
    return this;
  }

  /**
   * Finalize the if/else arms into a {@link ConditionalTask} plus the
   * downstream branch tasks, wired via dataflows from the conditional's
   * matching output ports. Returns the parent workflow for continued chaining.
   */
  public endIf(): Workflow {
    if (!this.thenSpec) {
      throw new WorkflowError(".endIf() called without a prior .then(...) call");
    }

    // Capture the immediately-preceding workflow task BEFORE the conditional is
    // added so its output can be wired INTO the conditional's input. Without
    // this, the ConditionalTask runs against empty input and the predicate sees
    // `{}` rather than the upstream task's output.
    const priorTask = getLastTask(this.workflow);

    const thenPort = "then";
    const elsePort = "else";

    const branches = [
      {
        id: thenPort,
        condition: this.condition,
        outputPort: thenPort,
      },
    ];

    if (this.elseSpec) {
      // Inverse condition so the "else" branch is mutually exclusive with "then".
      // If the user's condition throws, ConditionalTask's own error handling
      // treats both branches as not-matched; `defaultBranch: elsePort` below
      // then routes to else — matching ConditionalTask's error-as-false semantics.
      branches.push({
        id: elsePort,
        condition: (input: TaskInput) => !this.condition(input),
        outputPort: elsePort,
      });
    }

    const conditionalTask = new ConditionalTask({
      id: uuid4(),
      branches,
      exclusive: true,
      defaultBranch: this.elseSpec ? elsePort : undefined,
    });
    this.workflow.graph.addTask(conditionalTask);

    // Wire the prior task's output into the conditional's input so the predicate
    // evaluates against real upstream data. ConditionalTask accepts any input
    // (additionalProperties: true), so an all-ports edge passes the full output
    // through, mirroring the all-ports wiring used by connect()/onError().
    if (priorTask && priorTask.id !== conditionalTask.id) {
      this.workflow.graph.addDataflow(
        new Dataflow(priorTask.id, DATAFLOW_ALL_PORTS, conditionalTask.id, DATAFLOW_ALL_PORTS)
      );
    }

    const thenTask = instantiate(this.thenSpec);
    this.workflow.graph.addTask(thenTask);
    this.workflow.graph.addDataflow(new Dataflow(conditionalTask.id, thenPort, thenTask.id, "*"));

    if (this.elseSpec) {
      const elseTask = instantiate(this.elseSpec);
      this.workflow.graph.addTask(elseTask);
      this.workflow.graph.addDataflow(new Dataflow(conditionalTask.id, elsePort, elseTask.id, "*"));
    }

    // Record the branch terminus so a continuation can be validated. A two-arm
    // conditional leaves two mutually-exclusive leaf nodes with no join, so the
    // next .addTask(...) cannot pick a single predecessor and must throw. A
    // then-only conditional leaves a single leaf (the then task), which is a
    // safe predecessor to continue from.
    this.workflow.builder.markBranchTerminus(this.elseSpec ? 2 : 1);

    return this.workflow;
  }
}

interface BranchTaskSpec {
  readonly taskClass: ITaskConstructor<any, any, any>;
  readonly input?: unknown;
  readonly config?: unknown;
}

function instantiate(spec: BranchTaskSpec): ITask<any, any, any> {
  const config = {
    id: uuid4(),
    ...(spec.config as Record<string, unknown> | undefined),
    defaults: spec.input,
  };
  return new spec.taskClass(config as any);
}
