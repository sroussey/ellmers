/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IRunConfig,
  ITask,
  IWorkflow,
  TaskGraphRunConfig,
  WorkflowRunConfig,
} from "@workglow/task-graph";
import { TaskGraph } from "@workglow/task-graph";
import { detectCliTheme, setCliTheme } from "./terminal/detectTerminalTheme";
import { renderTaskInstanceRun, renderWorkflowRun } from "./ui/render";

function taskStaticType(task: ITask): string {
  const ctor = task.constructor as { type?: string };
  return typeof ctor.type === "string" ? ctor.type : "Task";
}

/** Detects workflow-shaped values (graph + run) without importing the Workflow class. */
function isWorkflowLike(arg: unknown): arg is IWorkflow {
  return (
    arg != null &&
    typeof arg === "object" &&
    "graph" in arg &&
    (arg as { graph: unknown }).graph instanceof TaskGraph &&
    "run" in arg &&
    typeof (arg as { run: unknown }).run === "function"
  );
}

/** Values that can be executed with CLI progress UI (TTY) or plain run when not a TTY. */
export type Tasklike = ITask | IWorkflow | TaskGraph;

export interface WithCliOptions {
  /** When true, do not print JSON to stdout on success (default for library-style callers). */
  readonly suppressResultOutput?: boolean;
}

export interface WithCliTaskHandle {
  readonly kind: "task";
  run(overrides?: Record<string, unknown>): Promise<unknown>;
  abort(): void;
}

export interface WithCliWorkflowHandle {
  readonly kind: "workflow";
  run(input?: Record<string, unknown>, config?: WorkflowRunConfig): Promise<unknown>;
  abort(): void;
}

export interface WithCliGraphHandle {
  readonly kind: "graph";
  run(input?: Record<string, unknown>, config?: TaskGraphRunConfig): Promise<unknown>;
  abort(): void;
}

export type WithCliHandle = WithCliTaskHandle | WithCliWorkflowHandle | WithCliGraphHandle;

function withCliTask(task: ITask, options?: WithCliOptions): WithCliTaskHandle {
  const suppressResultOutput = options?.suppressResultOutput ?? true;
  return {
    kind: "task",
    abort: () => {
      task.abort();
    },
    run: async (
      overrides?: Record<string, unknown>,
      runConfig?: Partial<IRunConfig>
    ): Promise<unknown> => {
      if (!process.stdout.isTTY) {
        return task.run(overrides, runConfig);
      }

      setCliTheme(await detectCliTheme());

      const taskType = taskStaticType(task);

      return renderTaskInstanceRun(task, taskType, {
        suppressResultOutput,
        overrides,
        runConfig,
      });
    },
  };
}

function withCliWorkflow(workflow: IWorkflow, options?: WithCliOptions): WithCliWorkflowHandle {
  const suppressResultOutput = options?.suppressResultOutput ?? true;
  return {
    kind: "workflow",
    abort: () => {
      workflow.graph.abort();
    },
    run: async (
      input: Record<string, unknown> = {},
      config?: WorkflowRunConfig
    ): Promise<unknown> => {
      if (!process.stdout.isTTY) {
        return workflow.run(input, config);
      }

      setCliTheme(await detectCliTheme());

      return renderWorkflowRun(workflow.graph, input, {
        config: config as Record<string, unknown> | undefined,
        runExecutor: () => workflow.run(input, config),
        suppressResultOutput,
      });
    },
  };
}

function withCliGraph(graph: TaskGraph, options?: WithCliOptions): WithCliGraphHandle {
  const suppressResultOutput = options?.suppressResultOutput ?? true;
  return {
    kind: "graph",
    abort: () => {
      graph.abort();
    },
    run: async (
      input: Record<string, unknown> = {},
      config?: TaskGraphRunConfig
    ): Promise<unknown> => {
      if (!process.stdout.isTTY) {
        return graph.run(input, config);
      }

      setCliTheme(await detectCliTheme());

      return renderWorkflowRun(graph, input, {
        config: config as Record<string, unknown> | undefined,
        runExecutor: () => graph.run(input, config),
        suppressResultOutput,
      });
    },
  };
}

export function withCli(task: ITask, options?: WithCliOptions): WithCliTaskHandle;
export function withCli(workflow: IWorkflow, options?: WithCliOptions): WithCliWorkflowHandle;
export function withCli(graph: TaskGraph, options?: WithCliOptions): WithCliGraphHandle;
export function withCli(tasklike: Tasklike, options?: WithCliOptions): WithCliHandle {
  if (tasklike instanceof TaskGraph) {
    return withCliGraph(tasklike, options);
  }
  if (isWorkflowLike(tasklike)) {
    return withCliWorkflow(tasklike, options);
  }
  return withCliTask(tasklike, options);
}
