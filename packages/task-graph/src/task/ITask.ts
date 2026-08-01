/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  EventEmitter,
  IDisposeStrategy,
  ResourceScope,
  ServiceRegistry,
} from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import type { CachePolicy } from "../cache/CachePolicy";
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

export interface IExecuteContext {
  signal: AbortSignal;
  /**
   * Stable identifier for the current graph run. Set when the caller passes
   * `runId` in the run config; `undefined` for ad-hoc task runs.
   */
  runId?: string;
  /**
   * Update the task's progress.
   * @param progress - 0..100 for measured progress, or `undefined` for
   *   indeterminate (in progress, percentage unknown). UIs render
   *   `undefined` as an indeterminate bar.
   * @param message - Optional human-readable phase / status label.
   */
  updateProgress: (progress: number | undefined, message?: string, ...args: any[]) => Promise<void>;
  /**
   * Register a task, graph, or workflow as a child of the running task so it
   * inherits the registry and abort signal, and shows up under the parent in
   * progress UIs.
   *
   * A graph or workflow is adapted into a wrapper task the caller never sees,
   * so `config` is the only way to name one — without it every owned workflow
   * renders as the same anonymous `Own[Workflow]` row. An argument that is
   * already an `ITask` keeps its own config; name those at construction.
   */
  own: <T extends ITask | ITaskGraph | IWorkflow>(i: T, config?: TaskConfig) => T;
  registry: ServiceRegistry;
  /**
   * Input streams for pass-through streaming tasks. Keyed by input port name.
   * Provided when the graph runner detects that a task has streaming input edges
   * and the task implements executeStream(). The task's executeStream() can read
   * from these streams and re-yield events for immediate downstream delivery.
   */
  inputStreams?: Map<string, ReadableStream<StreamEvent>>;
  /**
   * Resource scope for registering heavyweight resource disposers (model unload,
   * AI session close, browser disconnect, etc.).
   *
   * **Register synchronously from within `execute()` / `executeStream()`.**
   * The top-level runner disposes the scope as soon as the run completes;
   * disposers registered after `execute()` resolves will land on a cleared Map
   * and never be invoked.
   *
   * Always defined when the task is run via `Task.run()`, `TaskGraph.run()`,
   * or `Workflow.run()` — the top-level runner auto-creates one if the caller
   * did not provide it.
   */
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
   * The graph runner sets this on task.runConfig before each run.
   */
  runnerId?: string;

  /**
   * Output cache override for this run.
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

  /**
   * Optional callback invoked whenever a task's progress changes during execution.
   * @param task - The task whose progress changed.
   * @param progress - 0..100 for measured progress, or `undefined` for indeterminate.
   * @param message - Optional human-readable phase / status label.
   */
  updateProgress?: (
    task: ITask,
    progress: number | undefined,
    message?: string,
    ...args: any[]
  ) => Promise<void>;

  registry?: ServiceRegistry;

  /**
   * Stable identifier for the current graph run, threaded through from
   * {@link TaskGraphRunConfig.runId}. Exposed on {@link IExecuteContext} so
   * tasks can correlate their work to the enclosing run.
   */
  runId?: string;

  /**
   * Parent abort signal to link to this task's abort controller.
   * When the parent signal is aborted, this task will also be aborted.
   * Set automatically by context.own() to propagate cancellation from parent to child tasks.
   */
  signal?: AbortSignal;

  /**
   * Resource scope for collecting heavyweight resource disposers.
   *
   * If omitted, the top-level runner creates a private scope and `disposeAll()`s
   * it when the run finishes (success, error, or abort).
   *
   * If provided, the caller owns the lifecycle; the runner never calls
   * `disposeAll`.
   */
  resourceScope?: ResourceScope;

  /**
   * Strategy used to govern auto-created ResourceScope lifecycles. Only
   * consulted when this run auto-creates a scope (i.e. `resourceScope` is
   * not provided). Caller-passed scopes carry their own strategy.
   */
  disposeStrategy?: IDisposeStrategy;

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
  /** Coarse on/off cache flag. Setting `false` is equivalent to `cachePolicy: { kind: "none" }`. */
  readonly cacheable?: boolean;
  /** Canonical declaration of this task's cache policy. */
  readonly cachePolicy?: CachePolicy;
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
 * Interface for task execution logic — implemented by Task subclasses.
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
 * Interface for task lifecycle management — usually delegated to a TaskRunner.
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
  getCacheVersion(): string;
  getCachePolicy(inputs: Input): CachePolicy;
  narrowInput(input: Partial<Input>, registry: ServiceRegistry): Promise<Partial<Input>>;
  entitlements(): TaskEntitlements;
}

export interface ITaskInternalGraph {
  subGraph: TaskGraph;
  parentGraph?: TaskGraph;
  hasChildren(): boolean;
  regenerateGraph(): void;
}

export interface ITaskEvents {
  get events(): EventEmitter<TaskEventListeners>;

  on<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): void;
  off<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): void;
  once<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): void;
  waitOn<Event extends TaskEvents>(name: Event): Promise<TaskEventParameters<Event>>;
  emit<Event extends TaskEvents>(name: Event, ...args: TaskEventParameters<Event>): void;
  subscribe<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): () => void;
}

export interface ITaskSerialization {
  toJSON(options?: TaskGraphJsonOptions): JsonTaskItem | TaskGraphItemJson;
  toDependencyJSON(options?: TaskGraphJsonOptions): JsonTaskItem;
  get id(): unknown;
}

export interface ITaskState<Config extends TaskConfig = TaskConfig> {
  readonly config: Config;
  get id(): unknown;
  /**
   * Returns true when `id` is a stable, caller-pinned value (not the
   * autogenerated v4 UUID default). The run-private cache uses this to
   * decide whether to key by instance id (deterministic) or fall back to
   * keying by task type so a crash-restart can still find prior rows.
   */
  hasDeterministicId(): boolean;
  status: TaskStatus;
  /** 0..100 for measured progress, or `undefined` for indeterminate (in-progress, percentage unknown). */
  progress: number | undefined;
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

type ITaskConstructorType<
  Input extends TaskInput,
  Output extends TaskOutput,
  Config extends TaskConfig,
> = new (config: Config, runConfig?: Partial<IRunConfig>) => ITask<Input, Output, Config>;

export type ITaskConstructor<
  Input extends TaskInput,
  Output extends TaskOutput,
  Config extends TaskConfig,
> = ITaskConstructorType<Input, Output, Config> & ITaskStaticProperties;
