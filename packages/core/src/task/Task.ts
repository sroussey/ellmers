//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { EventEmitter } from "eventemitter3";
import { TaskGraph } from "./TaskGraph";
import { TaskGraphRunner } from "./TaskGraphRunner";
import type { TaskInputDefinition, TaskOutputDefinition } from "./TaskIOTypes";

export enum TaskStatus {
  PENDING = "NEW",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

/**
 * TaskEvents
 *
 * There is no job queue at the moement.
 */
export type TaskEvents = "start" | "complete" | "error" | "progress";

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
  id: string;
  name?: string;
}

abstract class TaskBase {
  // information about the task that should be overriden by the subclasses
  static readonly type: TaskTypeName = "TaskBase";
  static readonly category: string = "Hidden";

  events = new EventEmitter<TaskEvents>();
  on(name: TaskEvents, fn: (...args: any[]) => void) {
    this.events.on.call(this.events, name, fn);
  }
  off(name: TaskEvents, fn: (...args: any[]) => void) {
    this.events.off.call(this.events, name, fn);
  }
  emit(name: TaskEvents, ...args: any[]) {
    this.events.emit.call(this.events, name, ...args);
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
  error: string | undefined = undefined;

  constructor(config: TaskConfig = {}) {
    // pull out input data from the config
    const { input = {}, ...rest } = config;
    const inputdefs = (this.constructor as typeof TaskBase).inputs ?? [];
    const inputDefaults = inputdefs.reduce<Record<string, any>>((acc, cur) => {
      if (cur.defaultValue !== undefined) {
        acc[cur.id] = cur.defaultValue;
      }
      return acc;
    }, {});
    this.defaults = Object.assign(inputDefaults, input);
    this.resetInputData();

    // setup the configuration
    const name = (this.constructor as any).type ?? this.constructor.name;
    this.config = Object.assign(
      {
        id: name + ":" + Math.random().toString(36).substring(2, 9),
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

  resetInputData() {
    this.runInputData = { ...this.defaults };
  }
  addInputData<T extends TaskInput>(overrides: Partial<T> | undefined) {
    const inputdefs = (this.constructor as typeof TaskBase).inputs ?? [];
    for (const input of inputdefs) {
      if (overrides?.[input.id] !== undefined) {
        if (input.isArray) {
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
  }
  async run(): Promise<TaskOutput> {
    return this.runSyncOnly();
  }
  runSyncOnly(): TaskOutput {
    return this.runOutputData;
  }
}

export type TaskIdType = TaskBase["config"]["id"];

export class SingleTask extends TaskBase implements ITaskSimple {
  static readonly type: TaskTypeName = "SingleTask";
  readonly isCompound = false;
}

export class CompoundTask extends TaskBase implements ITaskCompound {
  static readonly type: TaskTypeName = "CompoundTask";

  declare runOutputData: TaskOutput;
  readonly isCompound = true;
  _subGraph: TaskGraph | null = null;
  set subGraph(subGraph: TaskGraph) {
    this._subGraph = subGraph;
  }
  get subGraph() {
    if (!this._subGraph) {
      this._subGraph = new TaskGraph();
    }
    return this._subGraph;
  }
  resetInputData() {
    super.resetInputData();
    this.subGraph.getNodes().forEach((node) => {
      node.resetInputData();
    });
  }
  async run(): Promise<TaskOutput> {
    this.emit("start");
    const runner = new TaskGraphRunner(this.subGraph);
    this.runOutputData.outputs = await runner.runGraph();
    this.emit("complete", this.runOutputData);
    // console.log(
    //   "complete",
    //   this.subGraph.getNodes().map((t) => (t.constructor as any).type),
    //   this.runInputData,
    //   this.runOutputData
    // );
    return this.runOutputData;
  }
  runSyncOnly(): TaskOutput {
    const runner = new TaskGraphRunner(this.subGraph);
    this.runOutputData.outputs = runner.runGraphSyncOnly();
    return this.runOutputData;
  }
}

// ===============================================================================

export type Task = SingleTask | CompoundTask;
export type TaskStream = Task[];
