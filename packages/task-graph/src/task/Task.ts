/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ServiceRegistry } from "@workglow/util";
import { deepEqual, EventEmitter, uuid4 } from "@workglow/util";
import type { DataPortSchema, SchemaNode } from "@workglow/util/schema";
import { compileSchema } from "@workglow/util/schema";
import { DATAFLOW_ALL_PORTS } from "../task-graph/Dataflow";
import { TaskGraph } from "../task-graph/TaskGraph";
import type { IExecuteContext, IExecutePreviewContext, IRunConfig, ITask } from "./ITask";
import { EMPTY_ENTITLEMENTS, type TaskEntitlements } from "./TaskEntitlements";
import {
  TaskAbortedError,
  TaskConfigurationError,
  TaskError,
  TaskInvalidInputError,
  TaskSerializationError,
} from "./TaskError";
import type {
  TaskEventListener,
  TaskEventListeners,
  TaskEventParameters,
  TaskEvents,
} from "./TaskEvents";
import type { JsonTaskItem, TaskGraphItemJson, TaskGraphJsonOptions } from "./TaskJSON";
import { TaskRunner } from "./TaskRunner";
import type { TaskConfig, TaskIdType, TaskInput, TaskOutput, TaskTypeName } from "./TaskTypes";
import { TaskConfigSchema, TaskStatus } from "./TaskTypes";

/**
 * Base class for all tasks that implements the ITask interface.
 * This abstract class provides common functionality for both simple and compound tasks.
 *
 * The Task class is responsible for:
 * 1. Defining what a task is (inputs, outputs, configuration)
 * 2. Providing the execution logic (via execute and executePreview)
 * 3. Delegating the running logic to a TaskRunner
 */
export class Task<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig = TaskConfig,
> implements ITask<Input, Output, Config> {
  // ========================================================================
  // Static properties - should be overridden by subclasses
  // ========================================================================

  /**
   * The type identifier for this task class
   */
  public static type: TaskTypeName = "Task";

  /**
   * The category this task belongs to
   */
  public static category: string = "Hidden";

  /**
   * The title of this task
   */
  public static title: string = "";

  /**
   * The description of this task
   */
  public static description: string = "";

  /**
   * Whether this task has side effects
   */
  public static cacheable: boolean = true;

  /**
   * Whether this task has dynamic input/output schemas that can change at runtime.
   * Tasks with dynamic schemas should override instance methods for inputSchema() and/or outputSchema()
   * and emit 'schemaChange' events when their schemas change.
   */
  public static hasDynamicSchemas: boolean = false;

  /**
   * When true, dynamically added input ports (via the universal "Add Input" handle in the builder)
   * are mirrored as output ports of the same name and type. Set this on pass-through tasks that
   * forward their additional inputs to their outputs unchanged.
   */
  public static passthroughInputsToOutputs: boolean = false;

  /**
   * When true, this task can be saved as a custom task with a preset configuration.
   * Tasks that have meaningful user-facing config options beyond the base fields should set this.
   */
  public static customizable: boolean = false;

  /**
   * When true, this task defines the graph's output. The graph runner will
   * collect results only from tasks with this flag when they exist among the
   * leaf nodes; otherwise it falls back to collecting from all leaves.
   */
  public static isGraphOutput: boolean = false;

  /**
   * When true, this task does no real work — it only forwards inputs to outputs
   * (e.g. `InputTask`, `OutputTask`). Such tasks are excluded from graph-level
   * progress averaging because they jump from 0% to 100% and would dilute the bar.
   */
  public static isPassthrough: boolean = false;

  /**
   * Whether this task has dynamic entitlements that can change at runtime.
   * Tasks with dynamic entitlements should override the instance entitlements() method
   * and emit 'entitlementChange' events when their entitlements change.
   */
  public static hasDynamicEntitlements: boolean = false;

  /**
   * Entitlements required by this task class.
   * Subclasses override to declare their permission requirements.
   */
  public static entitlements(): TaskEntitlements {
    return EMPTY_ENTITLEMENTS;
  }

  /**
   * Input schema for this task
   */
  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Output schema for this task
   */
  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Config schema for this task. Subclasses that add config properties MUST override this
   * and spread TaskConfigSchema["properties"] into their own properties object.
   */
  public static configSchema(): DataPortSchema {
    return TaskConfigSchema;
  }

  // ========================================================================
  // Task Execution Methods - Core logic provided by subclasses
  // ========================================================================

  /**
   * The actual task execution logic for subclasses to override
   *
   * @param input The input to the task
   * @param config The configuration for the task
   * @throws TaskError if the task fails
   * @returns The output of the task or undefined if no changes
   */
  public async execute(_input: Input, context: IExecuteContext): Promise<Output | undefined> {
    if (context.signal?.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    return undefined;
  }

  /**
   * Default implementation of executePreview that does nothing.
   * Subclasses should override this to provide actual preview functionality.
   *
   * This is generally for UI updating, and should be lightweight.
   * @param input The input to the task
   * @returns The preview output, or undefined for "no preview update"
   */
  public async executePreview(
    _input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return undefined;
  }

  // ========================================================================
  // TaskRunner delegation - Executes and manages the task
  // ========================================================================

  /**
   * The TaskGraph that owns this task, set by {@link TaskGraph#addTask}.
   * Used by {@link TaskRunner#runPreviewStream} to locate upstream tasks
   * and subscribe to their streaming events.
   */
  public parentGraph?: TaskGraph;

  /**
   * Task runner for handling the task execution
   */
  protected _runner: TaskRunner<Input, Output, Config> | undefined;

  /**
   * Gets the task runner instance
   * Creates a new one if it doesn't exist
   */
  public get runner(): TaskRunner<Input, Output, Config> {
    if (!this._runner) {
      this._runner = new TaskRunner<Input, Output, Config>(this);
    }
    return this._runner;
  }

  /**
   * Runs the task and returns the output
   * Delegates to the task runner
   *
   * @param overrides Optional input overrides
   * @param runConfig Optional per-call run configuration (merged with task's runConfig)
   * @throws TaskError if the task fails
   * @returns The task output
   */
  async run(overrides: Partial<Input> = {}, runConfig: Partial<IRunConfig> = {}): Promise<Output> {
    return this.runner.run(overrides, { ...this.runConfig, ...runConfig });
  }

  /**
   * Runs the task in preview mode
   * Delegates to the task runner
   *
   * @param overrides Optional input overrides
   * @returns The task output
   */
  public async runPreview(overrides: Partial<Input> = {}): Promise<Output> {
    return this.runner.runPreview(overrides);
  }

  /**
   * Aborts task execution
   * Delegates to the task runner
   */
  public abort(): void {
    this.runner.abort();
  }

  /**
   * Disables task execution
   * Delegates to the task runner
   */
  public async disable(): Promise<void> {
    await this.runner.disable();
  }

  // ========================================================================
  // Static to Instance conversion methods
  // ========================================================================

  /**
   * Gets input schema for this task
   */
  public inputSchema(): DataPortSchema {
    return (this.constructor as typeof Task).inputSchema();
  }

  /**
   * Gets output schema for this task
   */
  public outputSchema(): DataPortSchema {
    return (this.constructor as typeof Task).outputSchema();
  }

  /**
   * Gets config schema for this task
   */
  public configSchema(): DataPortSchema {
    return (this.constructor as typeof Task).configSchema();
  }

  /**
   * Gets entitlements for this task instance.
   * For tasks with dynamic entitlements, override this to compute based on config/state.
   */
  public entitlements(): TaskEntitlements {
    return (this.constructor as typeof Task).entitlements();
  }

  /**
   * Emits an entitlementChange event when the task's required entitlements change.
   * Call this from tasks with dynamic entitlements when their configuration changes
   * in a way that affects their entitlements.
   */
  protected emitEntitlementChange(entitlements?: TaskEntitlements): void {
    const final = entitlements ?? this.entitlements();
    this.emit("entitlementChange", final);
  }

  public get type(): TaskTypeName {
    return (this.constructor as typeof Task).type;
  }

  public get category(): string {
    return (this.constructor as typeof Task).category;
  }

  public get title(): string {
    return this.config?.title ?? (this.constructor as typeof Task).title;
  }

  public get description(): string {
    return this.config?.description ?? (this.constructor as typeof Task).description;
  }

  public get cacheable(): boolean {
    return (
      this.runConfig?.cacheable ??
      this.config?.cacheable ??
      (this.constructor as typeof Task).cacheable
    );
  }

  // ========================================================================
  // Instance properties using @template types
  // ========================================================================

  /**
   * Default input values for this task.
   * If no overrides at run time, then this would be equal to the input.
   * resetInputData() will reset inputs to these defaults.
   */
  defaults: Record<string, any>;

  /**
   * The input to the task at the time of the task run.
   * This takes defaults from construction time and overrides from run time.
   * It is the input that created the output.
   */
  runInputData: Record<string, any> = {};

  /**
   * The output of the task at the time of the task run.
   * This is the result of the task execution.
   */
  runOutputData: Record<string, any> = {};

  // ========================================================================
  // Task state properties
  // ========================================================================

  /**
   * The configuration of the task
   */
  config: Config;

  /**
   * Frozen snapshot of config at construction time, used by toJSON and
   * as the resolution source for re-runs (so fresh lookups use original IDs).
   */
  readonly originalConfig: Readonly<Record<string, unknown>> | undefined;

  /**
   * Task id from config (read-only).
   */
  public get id(): unknown {
    return this.config.id;
  }

  /**
   * Runtime configuration (not serialized with the task).
   * Set via the constructor's third argument or mutated by the graph runner.
   */
  runConfig: Partial<IRunConfig> = {};

  /**
   * Current status of the task
   */
  status: TaskStatus = TaskStatus.PENDING;

  /**
   * Progress of the task (0-100)
   */
  progress: number = 0;

  /**
   * When the task was created
   */
  createdAt: Date = new Date();

  /**
   * When the task started execution
   */
  startedAt?: Date;

  /**
   * When the task completed execution
   */
  completedAt?: Date;

  /**
   * Error that occurred during task execution, if any
   */
  error?: TaskError;

  /**
   * Event emitter for task lifecycle events
   */
  public get events(): EventEmitter<TaskEventListeners> {
    if (!this._events) {
      this._events = new EventEmitter<TaskEventListeners>();
    }
    return this._events;
  }
  protected _events: EventEmitter<TaskEventListeners> | undefined;

  /**
   * Creates a new task instance
   *
   * @param config Configuration for the task (includes defaults for input values)
   * @param runConfig Runtime configuration for the task
   */
  constructor(config: NoInfer<Partial<Config>> = {}, runConfig: NoInfer<Partial<IRunConfig>> = {}) {
    // Extract caller-provided defaults from config
    const { defaults: callerDefaultInputs, ...restConfig } = config as Partial<Config> & {
      defaults?: Partial<Input>;
    };

    // Initialize input defaults
    const inputDefaults = this.getDefaultInputsFromStaticInputDefinitions();
    const mergedDefaults = Object.assign(inputDefaults, callerDefaultInputs ?? {});
    // Strip symbol properties (like [$JSONSchema]) before storing defaults
    this.defaults = this.stripSymbols(mergedDefaults) as Record<string, any>;
    this.resetInputData();

    // Setup configuration defaults (title comes from static class property as fallback)
    const title = (this.constructor as typeof Task).title || undefined;
    const baseConfig = Object.assign(
      {
        ...(title ? { title } : {}),
      },
      restConfig
    ) as Config;
    if (baseConfig.id === undefined) {
      (baseConfig as Record<string, unknown>).id = uuid4();
    }
    this.config = this.validateAndApplyConfigDefaults(baseConfig);
    try {
      this.originalConfig = Object.freeze(structuredClone(this.config) as Record<string, unknown>);
    } catch {
      // Config contains non-cloneable values (e.g. functions).
      // canSerializeConfig() should return false for such tasks.
      this.originalConfig = undefined;
    }

    // Store runtime configuration
    this.runConfig = runConfig;
  }

  // ========================================================================
  // Input/Output handling
  // ========================================================================

  /**
   * Gets default input values from input schema
   */
  getDefaultInputsFromStaticInputDefinitions(): Partial<Input> {
    const schema = this.inputSchema();
    if (typeof schema === "boolean") {
      return {};
    }
    try {
      const compiledSchema = this.getInputSchemaNode();
      const defaultData = compiledSchema.getData(undefined, {
        addOptionalProps: true,
        removeInvalidData: false,
        useTypeDefaults: false,
      });
      return (defaultData || {}) as Partial<Input>;
    } catch (error) {
      console.warn(
        `Failed to compile input schema for ${this.type}, falling back to manual extraction:`,
        error
      );
      // Fallback to manual extraction if compilation fails
      return Object.entries(schema.properties || {}).reduce<Record<string, any>>(
        (acc, [id, prop]) => {
          const defaultValue = (prop as any).default;
          if (defaultValue !== undefined) {
            acc[id] = defaultValue;
          }
          return acc;
        },
        {}
      ) as Partial<Input>;
    }
  }

  /**
   * Resets input data to defaults
   */
  public resetInputData(): void {
    this.runInputData = this.smartClone(this.defaults) as Record<string, any>;
  }

  /**
   * Smart clone that deep-clones plain objects and arrays while preserving
   * class instances (objects with non-Object prototype) by reference.
   * Detects and throws an error on circular references.
   *
   * This is necessary because:
   * - structuredClone cannot clone class instances (methods are lost)
   * - JSON.parse/stringify loses methods and fails on circular references
   * - Class instances like repositories should be passed by reference
   *
   * This breaks the idea of everything being json serializable, but it allows
   * more efficient use cases. Do be careful with this though! Use sparingly.
   *
   * @param obj The object to clone
   * @param visited Set of objects in the current cloning path (for circular reference detection)
   * @returns A cloned object with class instances preserved by reference
   */
  private smartClone(obj: any, visited: WeakSet<object> = new WeakSet()): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    // Primitives (string, number, boolean, symbol, bigint) are returned as-is
    if (typeof obj !== "object") {
      return obj;
    }

    // Check for circular references
    if (visited.has(obj)) {
      throw new TaskConfigurationError(
        "Circular reference detected in input data. " +
          "Cannot clone objects with circular references."
      );
    }

    // Clone TypedArrays (Float32Array, Int8Array, etc.) to avoid shared-mutation
    // between defaults and runInputData, while preserving DataView by reference.
    if (ArrayBuffer.isView(obj)) {
      // Preserve DataView instances by reference (constructor signature differs)
      if (typeof DataView !== "undefined" && obj instanceof DataView) {
        return obj;
      }
      // For TypedArrays, create a new instance with the same data
      const typedArray = obj as any;
      return new (typedArray.constructor as any)(typedArray);
    }

    // Preserve class instances (objects with non-Object/non-Array prototype)
    // This includes repository instances, custom classes, etc.
    if (!Array.isArray(obj)) {
      const proto = Object.getPrototypeOf(obj);
      if (proto !== Object.prototype && proto !== null) {
        return obj; // Pass by reference
      }
    }

    // Add object to visited set before recursing
    visited.add(obj);

    try {
      // Deep clone arrays, preserving class instances within
      if (Array.isArray(obj)) {
        return obj.map((item) => this.smartClone(item, visited));
      }

      // Deep clone plain objects
      const result: Record<string, any> = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          result[key] = this.smartClone(obj[key], visited);
        }
      }
      return result;
    } finally {
      // Remove from visited set after processing to allow the same object
      // in different branches (non-circular references)
      visited.delete(obj);
    }
  }

  /**
   * Sets the default input values for the task
   *
   * @param defaults The default input values to set
   */
  public setDefaults(defaults: Partial<Input>): void {
    // Strip symbol properties (like [$JSONSchema]) before storing defaults
    this.defaults = this.stripSymbols(defaults) as Partial<Input>;
  }

  /**
   * Sets input values for the task
   *
   * @param input Input values to set
   */
  public setInput(input: Partial<Input>): void {
    const schema = this.inputSchema();
    if (typeof schema === "boolean") {
      if (schema === true) {
        for (const [inputId, value] of Object.entries(input)) {
          if (value !== undefined) {
            this.runInputData[inputId] = value;
          }
        }
      }
      return;
    }
    const properties = schema.properties || {};

    // Copy explicitly defined properties
    for (const [inputId, prop] of Object.entries(properties)) {
      if (input[inputId] !== undefined) {
        this.runInputData[inputId] = input[inputId];
      } else if (
        this.runInputData[inputId] === undefined &&
        (prop as { default?: unknown }).default !== undefined
      ) {
        this.runInputData[inputId] = prop.default;
      }
    }

    // If additionalProperties is true, also copy any additional input properties
    if (schema.additionalProperties) {
      for (const [inputId, value] of Object.entries(input)) {
        if (!(inputId in properties)) {
          this.runInputData[inputId] = value;
        }
      }
    }
  }

  /**
   * Adds/merges input data during graph execution.
   * Unlike {@link setInput}, this method:
   * - Detects changes using deep equality
   * - Accumulates array values (appends rather than replaces)
   * - Handles DATAFLOW_ALL_PORTS for pass-through
   * - Handles additionalProperties for dynamic schemas
   *
   * @param overrides The input data to merge
   * @returns true if any input data was changed, false otherwise
   */
  public addInput(overrides: Partial<Input> | undefined): boolean {
    if (!overrides) return false;

    let changed = false;
    const inputSchema = this.inputSchema();

    if (typeof inputSchema === "boolean") {
      if (inputSchema === false) {
        return false;
      }
      // Schema is `true` - accept any input
      for (const [key, value] of Object.entries(overrides)) {
        if (!deepEqual(this.runInputData[key], value)) {
          this.runInputData[key] = value;
          changed = true;
        }
      }
      return changed;
    }

    const properties = inputSchema.properties || {};

    for (const [inputId, prop] of Object.entries(properties)) {
      if (inputId === DATAFLOW_ALL_PORTS) {
        this.runInputData = { ...this.runInputData, ...overrides };
        changed = true;
      } else {
        if (overrides[inputId] === undefined) continue;
        const isArray =
          (prop as any)?.type === "array" ||
          ((prop as any)?.type === "any" &&
            (Array.isArray(overrides[inputId]) || Array.isArray(this.runInputData[inputId])));

        if (isArray) {
          const existingItems = Array.isArray(this.runInputData[inputId])
            ? this.runInputData[inputId]
            : this.runInputData[inputId] !== undefined
              ? [this.runInputData[inputId]]
              : [];
          const newitems = [...existingItems];

          const overrideItem = overrides[inputId];
          if (Array.isArray(overrideItem)) {
            newitems.push(...overrideItem);
          } else {
            newitems.push(overrideItem);
          }
          this.runInputData[inputId] = newitems;
          changed = true;
        } else {
          if (!deepEqual(this.runInputData[inputId], overrides[inputId])) {
            this.runInputData[inputId] = overrides[inputId];
            changed = true;
          }
        }
      }
    }

    // If additionalProperties is true, also accept any additional input properties
    if (inputSchema.additionalProperties) {
      for (const [inputId, value] of Object.entries(overrides)) {
        if (!(inputId in properties)) {
          if (!deepEqual(this.runInputData[inputId], value)) {
            this.runInputData[inputId] = value;
            changed = true;
          }
        }
      }
    }

    return changed;
  }

  /**
   * Stub for narrowing input. Override in subclasses for custom logic.
   * @param input The input to narrow
   * @param _registry Optional service registry for lookups
   * @returns The (possibly narrowed) input
   */
  public async narrowInput(
    input: Partial<Input>,
    _registry: ServiceRegistry
  ): Promise<Partial<Input>> {
    return input;
  }

  // ========================================================================
  // Event handling methods
  // ========================================================================

  /**
   * Subscribes to an event
   */
  public subscribe<Event extends TaskEvents>(
    name: Event,
    fn: TaskEventListener<Event>
  ): () => void {
    return this.events.subscribe(name, fn);
  }

  /**
   * Registers an event listener
   */
  public on<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): void {
    this.events.on(name, fn);
  }

  /**
   * Removes an event listener
   */
  public off<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): void {
    this.events.off(name, fn);
  }

  /**
   * Registers a one-time event listener
   */
  public once<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): void {
    this.events.once(name, fn);
  }

  /**
   * Returns a promise that resolves when the specified event is emitted
   */
  public waitOn<Event extends TaskEvents>(name: Event): Promise<TaskEventParameters<Event>> {
    return this.events.waitOn(name) as Promise<TaskEventParameters<Event>>;
  }

  /**
   * Emits an event
   */
  public emit<Event extends TaskEvents>(name: Event, ...args: TaskEventParameters<Event>): void {
    // Route through `events` so the emitter exists: `this._events?.emit` dropped progress when
    // nothing had accessed `task.events` yet (e.g. parent MapTask before CLI wired listeners).
    this.events.emit(name, ...args);
  }

  /**
   * Emits a schemaChange event when the task's input or output schema changes.
   * This should be called by tasks with dynamic schemas when their configuration
   * changes in a way that affects their schemas.
   *
   * @param inputSchema - The new input schema (optional, will use current schema if not provided)
   * @param outputSchema - The new output schema (optional, will use current schema if not provided)
   */
  protected emitSchemaChange(inputSchema?: DataPortSchema, outputSchema?: DataPortSchema): void {
    const finalInputSchema = inputSchema ?? this.inputSchema();
    const finalOutputSchema = outputSchema ?? this.outputSchema();
    this.emit("schemaChange", finalInputSchema, finalOutputSchema);
  }

  // ========================================================================
  // Input validation methods
  // ========================================================================

  /**
   * Gets the compiled config schema node, or undefined if no configSchema is defined.
   *
   * The compiled schema is cached directly on the concrete class object (not in a shared
   * inherited Map) so that each subclass always uses its own configSchema() result.
   * A shared Map keyed only by type name can be poisoned if a different class computes
   * and caches the schema first — e.g., due to cross-package static-method resolution
   * inconsistencies in bundled outputs.
   */
  private static getConfigSchemaNode(): SchemaNode | undefined {
    const schema = this.configSchema();
    if (!schema) return undefined;
    // Use Object.hasOwn so each class gets its own entry rather than inheriting
    // from a parent class that already cached under the same key.
    if (!Object.hasOwn(this, "__compiledConfigSchema")) {
      try {
        const schemaNode =
          typeof schema === "boolean"
            ? compileSchema(schema ? {} : { not: {} })
            : compileSchema(schema);
        Object.defineProperty(this, "__compiledConfigSchema", {
          value: schemaNode,
          writable: true,
          configurable: true,
          enumerable: false,
        });
      } catch (error) {
        console.warn(`Failed to compile config schema for ${this.type}:`, error);
        return undefined;
      }
    }
    return (this as any).__compiledConfigSchema as SchemaNode;
  }

  /**
   * Validates config against configSchema.
   * Returns config as-is; throws on validation errors.
   * Returns config as-is if no configSchema is defined.
   */
  private validateAndApplyConfigDefaults(config: Config): Config {
    const ctor = this.constructor as typeof Task;
    const schemaNode = ctor.getConfigSchemaNode();
    if (!schemaNode) return config;

    const result = schemaNode.validate(config);
    if (!result.valid) {
      const errorMessages = result.errors.map((e) => {
        const path = e.data?.pointer || "";
        return `${e.message}${path ? ` (${path})` : ""}`;
      });
      throw new TaskConfigurationError(
        `[${ctor.name}] Configuration Error: ${errorMessages.join(", ")}`
      );
    }

    return config;
  }

  protected static generateInputSchemaNode(schema: DataPortSchema) {
    if (typeof schema === "boolean") {
      if (schema === false) {
        return compileSchema({ not: {} });
      }
      return compileSchema({});
    }
    return compileSchema(schema);
  }

  /**
   * Gets the compiled input schema, cached per class (not in a shared inherited Map).
   * Uses Object.hasOwn so each subclass stores its own compiled schema and never
   * picks up a stale entry cached by a different class with the same type name.
   */
  protected static getInputSchemaNode(): SchemaNode {
    if (!Object.hasOwn(this, "__compiledInputSchema")) {
      const dataPortSchema = this.inputSchema();
      const schemaNode = this.generateInputSchemaNode(dataPortSchema);
      try {
        Object.defineProperty(this, "__compiledInputSchema", {
          value: schemaNode,
          writable: true,
          configurable: true,
          enumerable: false,
        });
      } catch (error) {
        // If compilation fails, fall back to accepting any object structure
        // This is a safety net for schemas that json-schema-library can't compile
        console.warn(
          `Failed to compile input schema for ${this.type}, falling back to permissive validation:`,
          error
        );
        Object.defineProperty(this, "__compiledInputSchema", {
          value: compileSchema({}),
          writable: true,
          configurable: true,
          enumerable: false,
        });
      }
    }
    return (this as any).__compiledInputSchema as SchemaNode;
  }

  protected getInputSchemaNode(): SchemaNode {
    return (this.constructor as typeof Task).getInputSchemaNode();
  }

  /**
   * Validates an input data object against the task's input schema
   */
  public async validateInput(input: Input): Promise<boolean> {
    if (typeof input !== "object" || input === null) {
      throw new TaskInvalidInputError("Input must be an object");
    }
    const ctor = this.constructor as typeof Task;
    let schemaNode: SchemaNode;
    if (ctor.hasDynamicSchemas) {
      // Dynamic-schema tasks use instance inputSchema() (e.g. config.inputSchema), not the static fallback.
      // The cached getInputSchemaNode uses static inputSchema() which would reject valid instance-specific inputs.
      const instanceSchema = this.inputSchema();
      schemaNode = ctor.generateInputSchemaNode(instanceSchema);
    } else {
      schemaNode = this.getInputSchemaNode();
    }
    const result = schemaNode.validate(input);

    if (!result.valid) {
      const errorMessages = result.errors.map((e) => {
        const path = e.data.pointer || "";
        return `${e.message}${path ? ` (${path})` : ""}`;
      });
      const err = new TaskInvalidInputError(
        `Task "${this.type}" (${this.id}): Input ${JSON.stringify(Object.keys(input))} does not match schema: ${errorMessages.join(", ")}`
      );
      err.taskType = this.type;
      err.taskId = this.id;
      throw err;
    }

    return true;
  }

  // ========================================================================
  // Serialization methods
  // ========================================================================

  /**
   * Strips symbol properties from an object to make it serializable
   * @param obj The object to strip symbols from
   * @returns A new object without symbol properties
   */
  private stripSymbols(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }
    // Preserve TypedArrays (Float32Array, Int8Array, etc.)
    if (ArrayBuffer.isView(obj)) {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.stripSymbols(item));
    }
    if (typeof obj === "object") {
      const proto = Object.getPrototypeOf(obj);
      if (proto !== Object.prototype && proto !== null) {
        return obj;
      }

      const result: Record<string, any> = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          result[key] = this.stripSymbols(obj[key]);
        }
      }
      return result;
    }
    return obj;
  }

  /**
   * Returns whether the task's config can be serialized to JSON.
   * Override in subclasses that store non-serializable values (functions) in config.
   * Called by toJSON — if false, toJSON throws TaskSerializationError.
   */
  public canSerializeConfig(): boolean {
    return true;
  }

  /**
   * Serializes the task and its subtasks into a format that can be stored
   * @param _options Options controlling serialization (used by subclasses)
   * @returns The serialized task and subtasks
   */
  public toJSON(_options?: TaskGraphJsonOptions): TaskGraphItemJson {
    const ctor = this.constructor as typeof Task;

    if (!this.canSerializeConfig() || !this.originalConfig) {
      throw new TaskSerializationError(this.type);
    }

    // Build config by extracting only serializable properties defined in the configSchema.
    // We filter through the schema to avoid accidentally including non-serializable
    // values (e.g. functions like WhileTask.condition) or internal-only properties
    // that were never part of the serialized output and that consuming applications
    // don't expect (e.g. `queue` from task-specific configs).
    const schema = ctor.configSchema();
    const schemaProperties =
      typeof schema !== "boolean" && schema?.properties
        ? (schema.properties as Record<string, Record<string, unknown>>)
        : {};

    const config: Record<string, unknown> = {};
    for (const [key, propSchema] of Object.entries(schemaProperties)) {
      if (key === "id") continue;
      // Skip internal properties marked as hidden (e.g. queue, compoundMerge)
      // except inputSchema/outputSchema/extras which are needed for task reconstruction
      if (
        propSchema?.["x-ui-hidden"] === true &&
        key !== "inputSchema" &&
        key !== "outputSchema" &&
        key !== "extras"
      ) {
        continue;
      }
      const value = (this.originalConfig as Record<string, unknown>)[key];
      if (value === undefined) continue;
      // Skip non-serializable values (functions, symbols, etc.)
      if (typeof value === "function" || typeof value === "symbol") continue;
      config[key] = value;
    }

    // Omit title/description when they match the static class defaults
    if (config.title === ctor.title) delete config.title;
    if (config.description === ctor.description) delete config.description;

    // Omit empty extras
    const extras = config.extras as Record<string, unknown> | undefined;
    if (!extras || Object.keys(extras).length === 0) delete config.extras;

    const base: TaskGraphItemJson = {
      id: this.id,
      type: this.type,
      defaults: this.defaults,
    };
    if (Object.keys(config).length > 0) {
      base.config = config;
    }

    // Include entitlements if present
    const taskEntitlements = this.entitlements();
    if (taskEntitlements.entitlements.length > 0) {
      base.entitlements = taskEntitlements;
    }

    return this.stripSymbols(base) as TaskGraphItemJson;
  }

  /**
   * Converts the task to a JSON format suitable for dependency tracking
   * @param options Options controlling serialization (used by subclasses)
   * @returns The task and subtasks in JSON thats easier for humans to read
   */
  public toDependencyJSON(options?: TaskGraphJsonOptions): JsonTaskItem {
    const json = this.toJSON(options);
    return json;
  }

  // ========================================================================
  // Internal graph methods
  // ========================================================================

  /**
   * Checks if the task has children. Useful to gate to use of the internal subGraph
   * as this will return without creating a new graph if graph is non-existent .
   *
   * @returns True if the task has children, otherwise false
   */
  public hasChildren(): boolean {
    return (
      this._subGraph !== undefined &&
      this._subGraph !== null &&
      this._subGraph.getTasks().length > 0
    );
  }

  private _taskAddedListener: (taskId: TaskIdType) => void = () => {
    this.emit("regenerate");
  };

  /**
   * The internal task graph containing subtasks
   *
   * In the base case, these may just be incidental tasks that are not part of the task graph
   * but are used to manage the task's state as part of task execution. Therefore, the graph
   * is not used by the default runner.
   */
  protected _subGraph: TaskGraph | undefined = undefined;

  /**
   * Sets the subtask graph for the compound task
   * @param subGraph The subtask graph to set
   */
  set subGraph(subGraph: TaskGraph) {
    if (this._subGraph) {
      this._subGraph.off("task_added", this._taskAddedListener);
    }
    this._subGraph = subGraph;
    this._subGraph.on("task_added", this._taskAddedListener);
  }

  /**
   * The internal task graph containing subtasks
   *
   * In the base case, these may just be incidental tasks that are not part of the task graph
   * but are used to manage the task's state as part of task execution. Therefore, the graph
   * is not used by the default runner.
   *
   * Creates a new graph if one doesn't exist.
   *
   * @returns The task graph
   */
  get subGraph(): TaskGraph {
    if (!this._subGraph) {
      this._subGraph = new TaskGraph();
      this._subGraph.on("task_added", this._taskAddedListener);
    }
    return this._subGraph;
  }

  /**
   * Regenerates the task graph, which is internal state to execute() with config.own()
   *
   * This is a destructive operation that removes all dataflows and tasks from the graph.
   * It is used to reset the graph to a clean state.
   *
   * GraphAsTask and others override this and do not call super
   */
  public regenerateGraph(): void {
    if (this.hasChildren()) {
      for (const dataflow of this.subGraph.getDataflows()) {
        this.subGraph.removeDataflow(dataflow);
      }
      for (const child of this.subGraph.getTasks()) {
        this.subGraph.removeTask(child.id);
      }
    }
    this.events.emit("regenerate");
  }
}
