/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventEmitter, ResourceScope, ServiceRegistry } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { TaskOutputRepository } from "../storage/TaskOutputRepository";
import { ITaskGraph } from "../task-graph/ITaskGraph";
import { IWorkflow } from "../task-graph/IWorkflow";
import type { TaskGraph } from "../task-graph/TaskGraph";
import { CompoundMergeStrategy } from "../task-graph/TaskGraphRunner";
import type { StreamEvent } from "./StreamTypes";
import type { TaskEntitlements } from "./TaskEntitlements";
import { TaskError } from "./TaskError";
import type {
  TaskEventListener,
  TaskEventListeners,
  TaskEventParameters,
  TaskEvents,
} from "./TaskEvents";
import type { JsonTaskItem, TaskGraphItemJson, TaskGraphJsonOptions } from "./TaskJSON";
import { TaskRunner } from "./TaskRunner";
import type { TaskConfig, TaskInput, TaskOutput, TaskStatus } from "./TaskTypes";

/**
 * Context for task execution
 */
export interface IExecuteContext {
  signal: AbortSignal;
  updateProgress: (progress: number, message?: string, ...args: any[]) => Promise<void>;
  own: <T extends ITask | ITaskGraph | IWorkflow>(i: T) => T;
  registry: ServiceRegistry;
  /**
   * Input streams for pass-through streaming tasks. Keyed by input port name.
   * Provided when the graph runner detects that a task has streaming input edges
   * and the task implements executeStream(). The task's executeStream() can read
   * from these streams and re-yield events for immediate downstream delivery.
   */
  inputStreams?: Map<string, ReadableStream<StreamEvent>>;
  /** Resource scope for registering heavyweight resource disposers. */
  resourceScope?: ResourceScope;
}

export type IExecutePreviewContext = Pick<IExecuteContext, "own">;

/**
 * Configuration for running a task (runtime concerns, not serialized with the task).
 * Passed to task.run() or set on the task instance via the constructor's second argument.
 */
export interface IRunConfig {
  /**
   * Runner ID to use for job-queue-based tasks (e.g. AiTask).
   * Previously lived in TaskConfig; moved here because it is a runtime concern.
   * The graph runner sets this on task.runConfig before each run.
   */
  runnerId?: string;

  /**
   * Output cache override for this run.
   * Previously lived in TaskConfig; moved here because it is a runtime concern.
   *  - true  → use the globally registered TaskOutputRepository
   *  - false → disable caching for this run
   *  - TaskOutputRepository instance → use this specific repository
   */
  outputCache?: TaskOutputRepository | boolean;

  /**
   * Runtime override for task cacheability.
   * When set, takes precedence over config.cacheable and the static `cacheable` property.
   */
  cacheable?: boolean;

  /**
   * Whether the streaming task runner should accumulate text-delta chunks and
   * emit an enriched finish event that merges the accumulated text into the
   * output. When true, the finish event carries complete port data so that
   * downstream dataflows can materialize values without re-accumulating.
   *
   * Defaults to `true` for standalone task execution (backward-compatible).
   * The graph runner sets this to `false` when no downstream edge needs
   * materialized data (cache off, all downstream tasks are also streaming).
   */
  shouldAccumulate?: boolean;

  updateProgress?: (
    task: ITask,
    progress: number,
    message?: string,
    ...args: any[]
  ) => Promise<void>;

  registry?: ServiceRegistry;

  /**
   * Parent abort signal to link to this task's abort controller.
   * When the parent signal is aborted, this task will also be aborted.
   * Set automatically by context.own() to propagate cancellation from parent to child tasks.
   */
  signal?: AbortSignal;

  /**
   * Resource scope for collecting heavyweight resource disposers.
   * When provided, tasks can register cleanup functions via context.resourceScope.
   * The caller controls when to invoke them.
   */
  resourceScope?: ResourceScope;

  /**
   * When true, check entitlements via the registered IEntitlementEnforcer
   * before graph execution begins. Throws TaskEntitlementError if denied.
   * Default: false (entitlements are declarative only, not enforced by the engine).
   */
  enforceEntitlements?: boolean;
}

/**
 * Interface for task static property metadata
 *
 *   ==== These should be overriden by every new Task class ====
 */
export interface ITaskStaticProperties {
  readonly type: string;
  readonly category?: string;
  readonly title?: string;
  readonly description?: string;
  readonly cacheable: boolean;
  readonly hasDynamicSchemas: boolean;
  readonly hasDynamicEntitlements: boolean;
  readonly passthroughInputsToOutputs?: boolean;
  readonly isGraphOutput?: boolean;
  readonly isPassthrough?: boolean;
  readonly customizable?: boolean;
  readonly inputSchema: () => DataPortSchema;
  readonly outputSchema: () => DataPortSchema;
  readonly configSchema: () => DataPortSchema;
  readonly entitlements: () => TaskEntitlements;
}

/**
 * Interface for task execution logic
 * These methods define how tasks are executed and should be implemented by Task subclasses
 */
export interface ITaskExecution<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
> {
  execute(input: Input, context: IExecuteContext): Promise<Output | undefined>;
  executePreview?(input: Input, ctx: IExecutePreviewContext): Promise<Output | undefined>;

  /**
   * Optional streaming execution method.
   * When implemented, returns an async iterable of StreamEvents instead of a single output.
   * Only available on tasks where the static `streamable` property is true.
   */
  executeStream?(input: Input, context: IExecuteContext): AsyncIterable<StreamEvent<Output>>;

  /**
   * Optional cleanup method called when a task is aborted.
   * Override this to release external resources (file handles, network connections, etc.)
   * that won't be cleaned up by the abort signal alone.
   */
  cleanup?(): Promise<void> | void;
}

/**
 * Interface for task lifecycle management
 * These methods define how tasks are run and are usually delegated to a TaskRunner
 */
export interface ITaskLifecycle<
  Input extends TaskInput,
  Output extends TaskOutput,
  Config extends TaskConfig,
> {
  run(overrides?: Partial<Input>, runConfig?: Partial<IRunConfig>): Promise<Output>;
  runPreview(overrides?: Partial<Input>): Promise<Output>;
  get runner(): TaskRunner<Input, Output, Config>;
  abort(): void;
  disable(): Promise<void>;
}

/**
 * Interface for task input/output operations
 */
export interface ITaskIO<Input extends TaskInput> {
  defaults: Record<string, any>;
  runInputData: Record<string, any>;
  runOutputData: Record<string, any>;
  runConfig: Partial<IRunConfig>;

  inputSchema(): DataPortSchema; // gets local access for static inputSchema property
  outputSchema(): DataPortSchema; // gets local access for static outputSchema property
  configSchema(): DataPortSchema; // gets local access for static configSchema property
  get type(): string; // gets local access for static type property
  get category(): string; // gets local access for static category property
  get title(): string; // gets local access for static title property
  get description(): string; // gets local access for static description property

  setDefaults(defaults: Partial<Input>): void;
  resetInputData(): void;
  setInput(input: Partial<Input>): void;
  addInput(overrides: Partial<Input> | undefined): boolean;
  validateInput(input: Input): Promise<boolean>;
  get cacheable(): boolean;
  narrowInput(input: Partial<Input>, registry: ServiceRegistry): Promise<Partial<Input>>;
  entitlements(): TaskEntitlements;
}

export interface ITaskInternalGraph {
  subGraph: TaskGraph;
  parentGraph?: TaskGraph;
  hasChildren(): boolean;
  regenerateGraph(): void;
}

/**
 * Interface for task event handling
 */
export interface ITaskEvents {
  get events(): EventEmitter<TaskEventListeners>;

  on<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): void;
  off<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): void;
  once<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): void;
  waitOn<Event extends TaskEvents>(name: Event): Promise<TaskEventParameters<Event>>;
  emit<Event extends TaskEvents>(name: Event, ...args: TaskEventParameters<Event>): void;
  subscribe<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): () => void;
}

/**
 * Interface for task serialization
 */
export interface ITaskSerialization {
  toJSON(options?: TaskGraphJsonOptions): JsonTaskItem | TaskGraphItemJson;
  toDependencyJSON(options?: TaskGraphJsonOptions): JsonTaskItem;
  get id(): unknown;
}

/**
 * Interface for task configuration and state
 */
export interface ITaskState<Config extends TaskConfig = TaskConfig> {
  readonly config: Config;
  get id(): unknown;
  status: TaskStatus;
  progress: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: TaskError;
}

/**
 * Main task interface that combines all the specialized interfaces
 */
export interface ITask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig = TaskConfig,
>
  extends
    ITaskState<Config>,
    ITaskIO<Input>,
    ITaskEvents,
    ITaskLifecycle<Input, Output, Config>,
    ITaskExecution<Input, Output>,
    ITaskSerialization,
    ITaskInternalGraph {}

export interface IGraphAsTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends ITask<Input, Output, Config> {
  get compoundMerge(): CompoundMergeStrategy;
}

/**
 * Type for task constructor
 */
type ITaskConstructorType<
  Input extends TaskInput,
  Output extends TaskOutput,
  Config extends TaskConfig,
> = new (config: Config, runConfig?: Partial<IRunConfig>) => ITask<Input, Output, Config>;

/**
 * Interface for task constructor with static properties
 */
export type ITaskConstructor<
  Input extends TaskInput,
  Output extends TaskOutput,
  Config extends TaskConfig,
> = ITaskConstructorType<Input, Output, Config> & ITaskStaticProperties;
