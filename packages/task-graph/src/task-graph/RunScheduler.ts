/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger } from "@workglow/util";
import type { ConditionalTask } from "../task/ConditionalTask";
import type { ITask } from "../task/ITask";
import type { Usage } from "../task/StreamTypes";
import { TaskError, TaskFailedError, TaskGraphTimeoutError } from "../task/TaskError";
import type { TaskInput, TaskOutput } from "../task/TaskTypes";
import { TaskStatus } from "../task/TaskTypes";
import type { EdgeMaterializer } from "./EdgeMaterializer";
import type { RunContext } from "./RunContext";
import type { TaskGraph, TaskGraphRunConfig } from "./TaskGraph";
import type { GraphResultArray, GraphSingleTaskResult, TaskGraphRunner } from "./TaskGraphRunner";
import { taskPrototypeHasOwnExecute } from "./TaskGraphRunner";
import type { ITaskGraphScheduler } from "./TaskGraphScheduler";

/**
 * Branch-routing check that avoids importing {@link ConditionalTask} as a value.
 * A value import here closes a module cycle back to `Task`, which leaves `Task`
 * undefined for any module that enters the cycle at `Task` itself.
 */
function isConditionalTask(node: ITask): node is ConditionalTask {
  return (node.constructor as { isConditionalTask?: boolean }).isConditionalTask === true;
}

/**
 * Key used to record a scheduler-iterator-level failure in
 * `ctx.failedTaskErrors` (as opposed to a per-task failure, which is keyed by
 * task id). Lets the runGraph epilogue treat a scheduler throw as a graph
 * failure rather than completing on partial results.
 */
const SCHEDULER_FAILURE_KEY = Symbol("scheduler-failure");

/**
 * @internal
 * Run-loop coordinator. Drives task selection via processScheduler,
 * arms graph-level timeout, propagates disabled cascade, aggregates progress,
 * and pushes status to outgoing edges.
 *
 * Stateless across runs — all per-run state arrives via `ctx`.
 *
 * Holds a back-reference to the facade so runLoop can call facade.runTask().
 * This keeps runTask as the single per-task choreography point that wires
 * EdgeMaterializer + StreamPump + the integration with TaskRunner.
 */
export class RunScheduler {
  constructor(
    private readonly graph: TaskGraph,
    private readonly processScheduler: ITaskGraphScheduler,
    private readonly facade: TaskGraphRunner
  ) {}

  /**
   * Pushes the status of a task to its target edges
   * @param node The task that produced the status
   *
   * For ConditionalTask, this method handles selective dataflow status:
   * - Active branch dataflows get COMPLETED status
   * - Inactive branch dataflows get DISABLED status
   */
  pushStatusFromNodeToEdges(
    node: ITask,
    ctx: RunContext | undefined,
    status?: TaskStatus,
    graph: TaskGraph = this.graph
  ): void {
    if (!node?.config?.id) return;

    const dataflows = graph.getTargetDataflows(node.id);
    const effectiveStatus = status ?? node.status;

    // Check if this is a ConditionalTask with selective branching
    if (isConditionalTask(node) && effectiveStatus === TaskStatus.COMPLETED) {
      // The task is the sole authority on its own port layout. Reconstructing
      // it here from `config.branches` silently produced an empty map for a
      // task driven by a serialized `conditionConfig` (which has no
      // `config.branches`), so every branch edge fell through to the
      // non-branch-port case and no downstream task was ever disabled.
      const portActiveStatus = node.getPortActiveStatus();

      for (const dataflow of dataflows) {
        // Preserve FAILED edges (e.g. transform chain failure) rather than
        // overwriting with the source task's completion status.
        if (dataflow.status === TaskStatus.FAILED) continue;
        const isActive = portActiveStatus.get(dataflow.sourceTaskPortId);
        if (isActive === undefined) {
          // Not a branch port (e.g., _activeBranches metadata) - use normal status
          dataflow.setStatus(effectiveStatus);
        } else {
          dataflow.setStatus(isActive ? TaskStatus.COMPLETED : TaskStatus.DISABLED);
        }
      }

      // Cascade disabled status to downstream tasks
      this.propagateDisabledStatus(ctx, graph);
      return;
    }

    // Default behavior for non-conditional tasks
    dataflows.forEach((dataflow) => {
      // Preserve FAILED edges (e.g. transform chain failure) rather than
      // overwriting with the source task's completion status.
      if (dataflow.status === TaskStatus.FAILED) return;
      dataflow.setStatus(effectiveStatus);
    });
  }

  /**
   * Propagates DISABLED status through the graph.
   *
   * When a task's ALL incoming dataflows are DISABLED, that task becomes unreachable
   * and should also be disabled. This cascades through the graph until no more
   * tasks can be disabled.
   *
   * This is used by ConditionalTask to disable downstream tasks on inactive branches.
   *
   * `_ctx` is accepted for symmetry with other RunScheduler methods (which thread
   * per-run state through the RunContext) and to leave room for future per-run
   * scheduling state without a signature change. Currently unused — the cascade
   * operates on graph-level task status alone.
   */
  propagateDisabledStatus(_ctx: RunContext | undefined, graph: TaskGraph = this.graph): void {
    let changed = true;

    // Keep iterating until no more changes (fixed-point iteration)
    while (changed) {
      changed = false;

      for (const task of graph.getTasks()) {
        // Only consider tasks that are still pending
        if (task.status !== TaskStatus.PENDING) {
          continue;
        }

        const incomingDataflows = graph.getSourceDataflows(task.id);

        // Skip tasks with no incoming dataflows (root tasks)
        if (incomingDataflows.length === 0) {
          continue;
        }

        // Check if ALL incoming dataflows are DISABLED
        const allDisabled = incomingDataflows.every((df) => df.status === TaskStatus.DISABLED);

        if (allDisabled) {
          // This task is unreachable - disable it synchronously
          // Set status directly to avoid async issues
          task.status = TaskStatus.DISABLED;
          task.progress = 100;
          task.completedAt = new Date();
          task.emit("disabled");
          task.emit("status", task.status);

          // Propagate disabled status to its outgoing dataflows
          graph.getTargetDataflows(task.id).forEach((dataflow) => {
            dataflow.setStatus(TaskStatus.DISABLED);
          });

          // Mark as completed in scheduler so it doesn't wait for this task
          this.processScheduler.onTaskCompleted(task.id);

          changed = true;
        }
      }
    }
  }

  /**
   * Handles progress updates for the task graph by averaging `progress` across tasks whose class
   * declares its own `execute` (see {@link taskPrototypeHasOwnExecute}). Other nodes are ignored.
   */
  async handleProgress(
    ctx: RunContext,
    task: ITask,
    progress: number | undefined,
    message?: string,
    ...args: any[]
  ): Promise<void> {
    const contributors = this.graph.getTasks().filter(taskPrototypeHasOwnExecute);
    if (contributors.length > 1) {
      const determinate = contributors.filter((t) => t.progress !== undefined);
      if (determinate.length === 0) {
        progress = undefined;
      } else {
        const sum = determinate.reduce((acc, t) => acc + t.progress!, 0);
        progress = Math.round(sum / determinate.length);
      }
    } else if (contributors.length === 1) {
      const [only] = contributors;
      progress = only.progress;
    }
    this.pushStatusFromNodeToEdges(task, ctx);
    // Emit aggregate progress before awaiting output push so UIs (and task `emit("progress")` in
    // TaskRunner) are not blocked when pushOutput/narrowInput is slow or stalls mid-run.
    this.graph.emit("graph_progress", progress, message, args);
    // Only push output for mid-run progress ticks while the task is actively executing.
    // Terminal-state handlers (complete, abort, error, disable) set task.status to their
    // terminal value before calling handleProgress(100), so the output push is skipped here —
    // the graph runner's own post-run pushOutputFromNodeToEdges handles the completed case.
    const isActive = task.status === TaskStatus.PROCESSING || task.status === TaskStatus.STREAMING;
    if (isActive && task.runOutputData && Object.keys(task.runOutputData).length > 0) {
      // Bracket access keeps `edgeMaterializer` protected on the facade — only `runScheduler` was widened to public.
      await this.facade["edgeMaterializer"].pushOutputFromNodeToEdges(task, task.runOutputData);
    }
  }

  /**
   * Arms the graph-level timeout. The timer fires `pendingGraphTimeoutError`
   * and aborts the run when elapsed. No-op when `timeoutMs <= 0`.
   *
   * @remarks Treats `timeoutMs <= 0` as "no timeout" (silent no-op), not as
   * "fire immediately". Callers that want immediate cancellation should call
   * `ctx.abortController.abort()` directly.
   */
  armGraphTimeout(timeoutMs: number, ctx: RunContext): void {
    if (timeoutMs <= 0) return;
    ctx.pendingGraphTimeoutError = undefined;
    ctx.graphTimeoutTimer = setTimeout(() => {
      ctx.pendingGraphTimeoutError = new TaskGraphTimeoutError(timeoutMs);
      ctx.abortController.abort();
    }, timeoutMs);
  }

  /**
   * Clears the graph-level timeout timer if active.
   */
  clearGraphTimeout(ctx: RunContext): void {
    if (ctx.graphTimeoutTimer !== undefined) {
      clearTimeout(ctx.graphTimeoutTimer);
      ctx.graphTimeoutTimer = undefined;
    }
  }

  /**
   * Inner for-await loop body of {@link TaskGraphRunner.runGraph}. Drives the
   * processScheduler, dispatches tasks via `facade.runTask`, routes errors,
   * and pushes status/error to outgoing edges. Returns the per-leaf results
   * (terminal-state precedence is the facade's responsibility).
   */
  async runLoop<O extends TaskOutput>(
    input: TaskInput,
    config: TaskGraphRunConfig | undefined,
    ctx: RunContext,
    edgeMat: EdgeMaterializer
  ): Promise<GraphResultArray<O>> {
    const results: GraphResultArray<O> = [];

    try {
      // TODO: A different graph runner may chunk tasks that are in parallel
      // rather them all currently available
      for await (const task of this.processScheduler.tasks()) {
        if (ctx.abortController.signal.aborted) {
          break;
        }

        if (ctx.failedTaskErrors.size > 0) {
          break;
        }

        const isRootTask = this.graph.getSourceDataflows(task.id).length === 0;

        const runAsync = async () => {
          let errorRouted = false;
          // Forward this task's own progress — from ctx.updateProgress OR a
          // direct task.emit("progress") — as a graph-level task_progress while
          // it is actively running. Terminal 100% ticks fire after the status
          // is set terminal, so the guard skips them (a finished/failed/skipped
          // task must not look like it's "running"). Guarded so a throwing
          // listener can't break the run loop.
          const offProgress = task.subscribe(
            "progress",
            (progress: number | undefined, message?: string, ...args: any[]) => {
              if (task.status === TaskStatus.PROCESSING || task.status === TaskStatus.STREAMING) {
                try {
                  this.graph.emit("task_progress", task.id, progress, message, ...args);
                } catch (err) {
                  getLogger().error("task_progress listener threw", {
                    taskId: task.id,
                    error: err,
                  });
                }
              }
            }
          );
          const offUsage = task.subscribe("usage", (usage: Usage, modelId: string | undefined) => {
            try {
              this.graph.emit("task_usage", task.id, usage, modelId);
            } catch (err) {
              getLogger().error("task_usage listener threw", { taskId: task.id, error: err });
            }
          });
          try {
            // Root tasks (no incoming dataflows) receive the graph run input so e.g.
            // InputTask can seed the graph. Downstream tasks rely only on dataflow
            // edges plus task defaults — unless matchAllEmptyInputs is true, in which case
            // we filter the input to only include properties that are not connected via dataflows.
            const taskInput = isRootTask
              ? input
              : config?.matchAllEmptyInputs
                ? edgeMat.filterInputForTask(task, input)
                : {};

            // Bracket access — runTask stays protected on purpose; this is the back-ref entry point.
            const taskPromise = this.facade["runTask"](task, taskInput);
            ctx.inProgressTasks.set(task.id, taskPromise);
            const taskResult = await taskPromise;

            if (this.graph.getTargetDataflows(task.id).length === 0) {
              // we save the results of all the leaves
              results.push(taskResult as GraphSingleTaskResult<O>);
            }
          } catch (error) {
            if (edgeMat.hasErrorOutputEdges(task)) {
              // Route the error through error-port dataflows instead of failing the graph.
              // pushErrorOutputToEdges sets edge statuses directly (COMPLETED for error
              // edges, DISABLED for normal edges), so we skip the normal status push.
              errorRouted = true;
              edgeMat.pushErrorOutputToEdges(task);
            } else {
              ctx.failedTaskErrors.set(task.id, error as TaskError);
            }
          } finally {
            offProgress();
            offUsage();
            // IMPORTANT: Push status to edges BEFORE notifying scheduler
            // This ensures dataflow statuses (including DISABLED) are set
            // before the scheduler checks which tasks are ready.
            // Skip normal status push when error routing already set edge statuses.
            if (!errorRouted) {
              this.pushStatusFromNodeToEdges(task, ctx);
              edgeMat.pushErrorFromNodeToEdges(task);
            }
            // Emit a per-task completion event carrying the authoritative output
            // so external consumers can react incrementally. Only successful
            // tasks emit — failures route through edges / failedTaskErrors above.
            // Guarded so a throwing listener cannot stall the scheduler (the
            // emit precedes onTaskCompleted) or escape the Promise.allSettled
            // loop unobserved.
            if (task.status === TaskStatus.COMPLETED) {
              try {
                this.graph.emit("task_complete", task.id, task.runOutputData);
              } catch (err) {
                getLogger().error("task_complete listener threw", {
                  taskId: task.id,
                  error: err,
                });
              }
            }
            this.processScheduler.onTaskCompleted(task.id);
          }
        };

        // Start task execution without awaiting
        // so we can have many tasks running in parallel
        // but keep track of them to make sure they get awaited
        // otherwise, things will finish after this promise is resolved
        ctx.inProgressFunctions.set(Symbol(task.id as string), runAsync());
      }
    } catch (err) {
      getLogger().error("Error running graph", { error: err });
      // A throw from the scheduler iterator itself (not an individual task) must
      // propagate as a graph failure, not be logged-and-dropped on the success
      // path. Record it so the runGraph epilogue throws instead of calling
      // handleComplete and emitting "complete" on a partial run.
      const schedulerError =
        err instanceof TaskError
          ? err
          : new TaskFailedError(err instanceof Error ? err.message : String(err));
      ctx.failedTaskErrors.set(SCHEDULER_FAILURE_KEY, schedulerError);
    }

    // Wait for all tasks to complete since we did not await runAsync()/this.runTaskWithProvenance()
    await Promise.allSettled(Array.from(ctx.inProgressTasks.values()));
    // Clean up stragglers to avoid unhandled promise rejections
    await Promise.allSettled(Array.from(ctx.inProgressFunctions.values()));

    return results;
  }
}
