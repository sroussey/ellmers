/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask } from "../task/ITask";
import type { StreamEvent } from "../task/StreamTypes";
import type { JsonTaskItem, TaskGraphJson, TaskGraphJsonOptions } from "../task/TaskJSON";
import type { TaskIdType, TaskInput, TaskOutput, TaskStatus } from "../task/TaskTypes";
import type { Dataflow, DataflowIdType } from "./Dataflow";
import type { TaskGraphRunConfig } from "./TaskGraph";
import type { TaskGraphEventListener, TaskGraphEvents } from "./TaskGraphEvents";
import type {
  CompoundMergeStrategy,
  GraphResult,
  GraphResultArray,
  TaskGraphRunner,
} from "./TaskGraphRunner";

export interface ITaskGraph {
  get runner(): TaskGraphRunner;
  run<ExecuteOutput extends TaskOutput>(
    input?: TaskInput,
    config?: TaskGraphRunConfig
  ): Promise<GraphResultArray<ExecuteOutput>>;
  runPreview<Output extends TaskOutput>(input?: TaskInput): Promise<GraphResultArray<Output>>;
  mergeExecuteOutputsToRunOutput<
    ExecuteOutput extends TaskOutput,
    Merge extends CompoundMergeStrategy = CompoundMergeStrategy,
  >(
    results: GraphResultArray<ExecuteOutput>,
    compoundMerge: Merge
  ): GraphResult<ExecuteOutput, Merge>;
  abort(): void;
  disable(): Promise<void>;
  getTask(id: TaskIdType): ITask | undefined;
  getTasks(): ITask[];
  topologicallySortedNodes(): ITask[];
  addTask(task: ITask): void;
  addTasks(tasks: ITask[]): void;
  addDataflow(dataflow: Dataflow): void;
  addDataflows(dataflows: Dataflow[]): void;
  getDataflow(id: DataflowIdType): Dataflow | undefined;
  getDataflows(): Dataflow[];
  getSourceDataflows(taskId: unknown): Dataflow[];
  getTargetDataflows(taskId: unknown): Dataflow[];
  getSourceTasks(taskId: unknown): ITask[];
  getTargetTasks(taskId: unknown): ITask[];
  removeTask(taskId: unknown): void;
  toJSON(options?: TaskGraphJsonOptions): TaskGraphJson;
  toDependencyJSON(options?: TaskGraphJsonOptions): JsonTaskItem[];
  subscribe<Event extends TaskGraphEvents>(
    event: Event,
    fn: TaskGraphEventListener<Event>
  ): () => void;
  subscribeToTaskStatus(callback: (taskId: TaskIdType, status: TaskStatus) => void): () => void;
  subscribeToTaskProgress(
    callback: (
      taskId: TaskIdType,
      progress: number | undefined,
      message?: string,
      ...args: any[]
    ) => void
  ): () => void;
  subscribeToDataflowStatus(
    callback: (dataflowId: DataflowIdType, status: TaskStatus) => void
  ): () => void;
  subscribeToTaskStreaming(callbacks: {
    onStreamStart?: (taskId: TaskIdType) => void;
    onStreamChunk?: (taskId: TaskIdType, event: StreamEvent) => void;
    onStreamEnd?: (taskId: TaskIdType, output: Record<string, any>) => void;
  }): () => void;
}
