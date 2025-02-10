//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { EventEmitter } from "eventemitter3";
import { nanoid } from "nanoid";
import { TaskGraph, TaskGraphItemJson } from "./TaskGraph";
import { TaskGraphRunner } from "./TaskGraphRunner";
import type { JsonTaskItem } from "../JsonTask";
import { TaskOutputRepository } from "../../storage/taskoutput/TaskOutputRepository";

export enum TaskStatus {
  PENDING = "NEW",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  ABORTING = "ABORTING",
  FAILED = "FAILED",
}

/**
 * TaskEvents
 *
 * There is no job queue at the moement.
 */
export type TaskEvents = "start" | "complete" | "abort" | "error" | "progress" | "regenerate";

export interface TaskInput {
  [key: string]: any;
}
export interface TaskOutput {
  [key: string]: any;
}

export interface ITaskSimple {
  readonly isCompound: false;
}
export interface ITaskCompound {
  readonly isCompound: true;
  subGraph: TaskGraph;
}

export type ITask = ITaskSimple | ITaskCompound;

export type TaskTypeName = string;

export type TaskConfig = Partial<IConfig> & { input?: TaskInput };

// ===============================================================================

export interface IConfig {
  id: unknown;
  name?: string;
  provenance?: TaskInput;
}

export type TaskInputDefinition = {
  readonly id: string;
  readonly name: string;
  readonly valueType: string;
  readonly isArray?: boolean;
  readonly defaultValue?: unknown;
};

export type TaskOutputDefinition = {
  readonly id: string;
  readonly name: string;
  readonly valueType: string;
  readonly isArray?: boolean;
};

/**
 * Base class for all tasks
 */
export abstract class TaskBase {
  // information about the task that should be overriden by the subclasses
  static readonly type: TaskTypeName = "TaskBase";
  static readonly category: string = "Hidden";
  static readonly sideeffects: boolean = false;

  get inputs(): TaskInputDefinition[] {
    return ((this.constructor as typeof TaskBase).inputs as TaskInputDefinition[]) ?? [];
  }
  get outputs(): TaskOutputDefinition[] {
    return ((this.constructor as typeof TaskBase).outputs as TaskOutputDefinition[]) ?? [];
  }

  events = new EventEmitter<TaskEvents>();
  on(name: TaskEvents, fn: (...args: any[]) => void) {
    this.events.on(name, fn);
  }
  off(name: TaskEvents, fn: (...args: any[]) => void) {
    this.events.off(name, fn);
  }
  emit(name: TaskEvents, ...args: any[]) {
    this.events.emit(name, ...args);
  }

  /**
   * Does this task have subtasks?
   */
  abstract readonly isCompound: boolean;
  /**
   * Configuration for the task, might include things like name and id for the database
   */
  config: IConfig;
  status: TaskStatus = TaskStatus.PENDING;
  progress: number = 0;
  createdAt: Date = new Date();
  startedAt?: Date;
  completedAt?: Date;
  error?: string;

  constructor(config: TaskConfig = {}) {
    // pull out input data from the config
    const { input = {}, ...rest } = config;
    const inputDefaults = this.inputs.reduce<Record<string, any>>((acc, cur) => {
      if (cur.defaultValue !== undefined) {
        acc[cur.id] = cur.defaultValue;
      }
      return acc;
    }, {});
    this.defaults = Object.assign(inputDefaults, input);
    this.resetInputData();

    // setup the configuration
    const name = new.target.type || new.target.name;
    this.config = Object.assign(
      {
        id: nanoid(),
        name: name,
      },
      rest
    );
    // setup the events
    this.setupEvents();
  }

  public setupEvents() {
    Object.defineProperty(this, "events", { enumerable: false }); // in case it is serialized
    this.on("start", () => {
      this.startedAt = new Date();
      this.progress = 0;
      this.status = TaskStatus.PROCESSING;
    });
    this.on("complete", () => {
      this.completedAt = new Date();
      this.progress = 100;
      this.status = TaskStatus.COMPLETED;
    });
    this.on("error", (error) => {
      this.completedAt = new Date();
      this.progress = 100;
      this.status = TaskStatus.FAILED;
      this.error = error;
    });
  }
  /**
   * The defaults for the task. If no overrides at run time, then this would be equal to the
   * input
   */
  defaults: TaskInput;
  /**
   * The input to the task at the time of the task run. This takes defaults from construction
   * time and overrides from run time. It is the input that created the output.
   */
  runInputData: TaskInput = {};
  /**
   * The output of the task at the time of the task run. This is the result of the task.
   * The the defaults and overrides are combined to match the required input of the task.
   */
  runOutputData: TaskOutput = {};

  public static inputs: readonly TaskInputDefinition[];
  public static outputs: readonly TaskOutputDefinition[];

  /**
   *
   * @returns TaskInput Values that are used by the task runner, usually for storing results
   */
  getProvenance(): TaskInput {
    return this.config.provenance ?? {};
  }

  resetInputData() {
    // Use deep clone to avoid state leakage.
    if (typeof structuredClone === "function") {
      this.runInputData = structuredClone(this.defaults);
    } else {
      this.runInputData = JSON.parse(JSON.stringify(this.defaults));
    }
  }

  /**
   *
   * ONLY CALLED BY THE TASK RUNNER
   *
   * @param overrides
   * @returns
   */
  addInputData<T extends TaskInput>(overrides: Partial<T> | undefined) {
    for (const input of this.inputs) {
      if (overrides?.[input.id] !== undefined) {
        let isArray = input.isArray;
        if (
          input.valueType === "any" &&
          (Array.isArray(overrides[input.id]) || Array.isArray(this.runInputData[input.id]))
        ) {
          isArray = true;
        }

        if (isArray) {
          const newitems = [...(this.runInputData[input.id] || [])];
          const overrideItem = overrides[input.id];
          if (Array.isArray(overrideItem)) {
            newitems.push(...(overrideItem as any[]));
          } else {
            newitems.push(overrideItem);
          }
          this.runInputData[input.id] = newitems;
        } else {
          this.runInputData[input.id] = overrides[input.id];
        }
      }
    }
    return this;
  }

  /**
   * Validates an item against the task's input definition
   *
   * By default, we only check "number", "text", "boolean", and "function"
   * @param valueType The type of the item
   * @param item The item to validate
   * @returns True if the item is valid, false otherwise
   */
  async validateItem(valueType: string, item: any) {
    switch (valueType) {
      case "any":
        return true;
      case "number":
        return typeof item === "bigint" || typeof item === "number";
      case "text":
        return typeof item === "string";
      case "boolean":
        return typeof item === "boolean";
      case "function":
        return typeof item === "function";
      default:
        console.warn(`validateItem: Unknown value type: ${valueType}`);
        return false;
    }
  }

  /**
   * Validates an input item against the task's input definition
   * @param input The input to validate
   * @param inputId The id of the input to validate
   * @returns True if the input is valid, false otherwise
   */
  async validateInputItem(input: Partial<TaskInput>, inputId: keyof TaskInput) {
    const classRef = this.constructor as typeof TaskBase;
    const inputdef = this.inputs.find((def) => def.id === inputId);
    if (!inputdef) {
      return false;
    }
    if (typeof input !== "object") return false;
    if (inputdef.defaultValue !== undefined && input[inputId] === undefined) {
      // if there is no default value, that implies the value is required
      console.warn(
        `No default value for '${inputId}' in a ${classRef.type} so assumed required and not given (id:${this.config.id})`
      );
      return false;
    } else if (input[inputId] === undefined) {
      input[inputId] = inputdef.defaultValue;
    }
    if (inputdef.isArray && !Array.isArray(input[inputId])) {
      input[inputId] = [input[inputId]];
    }

    const inputlist: any[] = inputdef.isArray ? input[inputId] : [input[inputId]];

    // Rewritten using Promise.all for asynchronous validation
    const validationPromises = inputlist.map((item) =>
      this.validateItem(inputdef.valueType as string, item)
    );
    const validationResults = await Promise.all(validationPromises);
    return validationResults.every(Boolean);
  }

  /**
   * Validates an input data object against the task's input definition
   * @param input The input to validate
   * @returns True if the input is valid, false otherwise
   */
  async validateInputData(input: Partial<TaskInput>) {
    for (const inputdef of this.inputs) {
      if ((await this.validateInputItem(input, inputdef.id)) === false) {
        return false;
      }
    }
    return true;
  }

  /**
   * Runs the task
   * @returns The output of the task
   */
  async run(): Promise<TaskOutput> {
    if (!(await this.validateInputData(this.runInputData))) {
      throw new Error("Invalid input data");
    }
    this.emit("start");
    const result = await this.runReactive();
    this.runOutputData = result;
    this.emit("complete");
    return result;
  }
  /**
   * Runs the task reactively
   * @returns The output of the task
   */
  async runReactive(): Promise<TaskOutput> {
    return this.runOutputData;
  }

  /**
   * Converts the task to a JSON format suitable for dependency tracking
   * @returns The task in JSON format
   */
  toJSON(): JsonTaskItem {
    const p = this.getProvenance();
    return {
      id: this.config.id,
      type: (this.constructor as typeof TaskBase).type,
      input: this.defaults,
      ...(Object.keys(p).length ? { provenance: p } : {}),
    };
  }
  /**
   * Converts the task to a JSON format suitable for dependency tracking
   * @returns The task in JSON format
   */
  toDependencyJSON(): JsonTaskItem {
    return this.toJSON();
  }

  /**
   * Aborts the task
   * @returns A promise that resolves when the task is aborted
   */
  async abort(): Promise<void> {
    this.emit("abort");
  }
}

export type TaskIdType = TaskBase["config"]["id"];

/**
 * Represents a single task, which is a basic unit of work in the task graph
 */
export class SingleTask extends TaskBase implements ITaskSimple {
  static readonly type: TaskTypeName = "SingleTask";
  readonly isCompound = false;
}

/**
 * Represents a compound task, which is a task that contains other tasks
 */
export class CompoundTask extends TaskBase implements ITaskCompound {
  static readonly type: TaskTypeName = "CompoundTask";

  declare runOutputData: TaskOutput;
  readonly isCompound = true;
  _subGraph: TaskGraph | null = null;
  /**
   * Sets the subtask graph for the compound task
   * @param subGraph The subtask graph to set
   */
  set subGraph(subGraph: TaskGraph) {
    this._subGraph = subGraph;
  }
  /**
   * Gets the subtask graph for the compound task
   * @returns The subtask graph
   */
  get subGraph() {
    if (!this._subGraph) {
      this._subGraph = new TaskGraph();
    }
    return this._subGraph;
  }
  /**
   * Resets the input data for the compound task and its subtasks
   */
  resetInputData() {
    super.resetInputData();
    this.subGraph.getNodes().forEach((node) => {
      node.resetInputData();
    });
  }
  /**
   * Runs the compound task
   * @param nodeProvenance The provenance for the subtasks
   * @param repository The repository to use for caching task outputs
   * @returns The output of the compound task
   */
  async run(
    nodeProvenance: TaskInput = {},
    repository?: TaskOutputRepository
  ): Promise<TaskOutput> {
    if (!this.validateInputData(this.runInputData)) throw new Error("Invalid input data");
    this.emit("start");
    const runner = new TaskGraphRunner(this.subGraph, repository);
    this.runOutputData.outputs = await runner.runGraph(nodeProvenance);
    this.emit("complete");
    return this.runOutputData;
  }
  async runReactive(): Promise<TaskOutput> {
    const runner = new TaskGraphRunner(this.subGraph);
    this.runOutputData.outputs = await runner.runGraphReactive();
    return this.runOutputData;
  }

  /**
   * This serializes the task and its subtasks into a format that can be stored in a database
   * @returns TaskExportFormat
   */
  toJSON(): TaskGraphItemJson {
    this.resetInputData();
    return { ...super.toJSON(), subgraph: this.subGraph.toJSON() };
  }
  /**
   * Converts the task to a JSON format suitable for dependency tracking
   * @returns The task in JSON format
   */
  toDependencyJSON(): JsonTaskItem {
    this.resetInputData();
    return { ...super.toDependencyJSON(), subtasks: this.subGraph.toDependencyJSON() };
  }
}

/**
 * Represents a regenerative compound task, which is a task that contains other tasks and can regenerate its subtasks
 */
export class RegenerativeCompoundTask extends CompoundTask {
  static readonly type: TaskTypeName = "CompoundTask";
  /**
   * Emits a "regenerate" event when the subtask graph is regenerated
   */
  public regenerateGraph() {
    this.emit("regenerate", this.subGraph);
  }
}

// ===============================================================================

export type Task = SingleTask | CompoundTask;
export type TaskStream = Task[];
