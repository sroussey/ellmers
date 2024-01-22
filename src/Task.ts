//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { EventEmitter } from "eventemitter3";
import { deepEqual } from "./util/Misc";

/**
 * WARNING!
 * TODO!
 *
 * Task input and output is not type safe. It is super brittle and hacky. I am thinking about a visual
 * UI editor for tasks where you can map inputs and outputs, see what will run before you run it, etc.
 *
 * Also, task provenance is not tracked which is terrible for keeping state and caching intermediate results.
 */

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

// ===============================================================================

export type StreamableTaskKind = "TASK" | "TASK_LIST" | "STRATEGY";

// ===============================================================================

export type TaskStreamable = Task | TaskList | Strategy;
export type TaskStream = TaskStreamable[];

// ===============================================================================

export interface TaskConfig {
  name?: string;
  id?: unknown;
  output_name?: string;
}

type TaskConfigFull = TaskConfig & { output_name: string };

export interface TaskInput {
  [key: string]: any;
}

abstract class TaskBase {
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
   * The defaults for the task. If no overrides at run time, then this would be equal to the
   * input
   */
  defaults: TaskInput = {};
  /**
   * The input to the task at the time of the task run. This takes defaults from construction
   * time and overrides from run time. It is the input that created the output.
   */
  input: TaskInput = {};
  /**
   * The output of the task at the time of the task run. This is the result of the task.
   * The the defaults and overrides are combined to match the required input of the task.
   */
  output: TaskInput = {};
  /**
   * Configuration for the task, might include things like name and id for the database
   */
  config: TaskConfigFull = { output_name: "out" };
  status: TaskStatus = TaskStatus.PENDING;
  progress: number = 0;
  createdAt: Date = new Date();
  completedAt: Date | null = null;
  error: string | undefined = undefined;

  /**
   *
   * This calculates the input to the task at the time of the task run. This takes defaults from
   * construction and applies run time overrides (which may be output from a previous run if this
   * is a serial task or strategy). Caller needs to decide if should set to this classes input
   * or not.
   */
  withDefaults<T = TaskInput>(...overrides: (Partial<T> | undefined)[]): T {
    return Object.assign({}, this.defaults, ...overrides) as T;
  }

  constructor(config: TaskConfig = {}, defaults: TaskInput = {}) {
    Object.defineProperty(this, "events", { enumerable: false });
    this.defaults = defaults;
    this.input = this.withDefaults();
    this.config = Object.assign({}, this.config, config);
    this.on("start", () => {
      this.status = TaskStatus.PROCESSING;
    });
    this.on("complete", () => {
      this.completedAt = new Date();
      this.status = TaskStatus.COMPLETED;
    });
    this.on("error", (error) => {
      this.completedAt = new Date();
      this.status = TaskStatus.FAILED;
      this.error = error;
    });
  }

  abstract run(overrides?: TaskInput): Promise<TaskInput>;
}

export abstract class Task extends TaskBase {
  readonly kind = "TASK";
}

// ===============================================================================

export enum TaskListOrdering {
  SERIAL = "SERIAL",
  PARALLEL = "PARALLEL",
}

export abstract class MultiTaskBase extends TaskBase {
  abstract ordering: TaskListOrdering;
  tasks: TaskStream = [];
  started = 0;
  completed = 0;
  total = 0;
  errors = 0;

  constructor(
    config: TaskConfig = {},
    tasks: TaskStream = [],
    defaults: TaskInput = {}
  ) {
    super(config, defaults);
    this.setTasks(tasks);
  }

  setTasks(tasks: TaskStream) {
    if (this.tasks.length) {
      this.tasks.forEach((task) => {
        task.off("complete", this.#completeTask);
        task.off("error", this.#errorTask);
      });
    }
    this.tasks = tasks;
    tasks.forEach((task) => {
      task.on("complete", this.#completeTask);
      task.on("error", this.#errorTask);
    });
  }

  generateTasks() {}

  async run(overrides?: TaskInput) {
    try {
      this.emit("start");
      this.input = this.withDefaults(overrides);
      // TODO: dont regenerate if defaults are the same as input (only check what matters)
      if (this.generateTasks && !deepEqual(this.input, this.defaults))
        this.generateTasks(); // only strategy should do this
      const total = this.tasks.length;
      let taskInput = {};
      for (const task of this.tasks) {
        await task.run(taskInput);
        if (this.tasks[this.tasks.length - 1] == task) {
          // if last task, their result is our result
          this.output = task.output;
          break;
        }
        taskInput = Object.assign({}, task.output);
        this.emit("progress", this.completed / total);
        if (this.errors) {
          this.emit("error", this.error);
          break;
        }
      }
      this.emit("complete");
      return this.output;
    } catch (e) {
      this.emit("error", String(e));
      return this.output;
    }
  }

  #completeTask() {
    this.completed++;
    this.emit("progress", this.completed / this.total);
  }

  #errorTask(error: string) {
    this.errors++;
    this.error = this.error ? this.error + " & " + error : error;
  }
}

export abstract class TaskList extends MultiTaskBase {
  readonly kind = "TASK_LIST";
  declare _tasks: Task[];
}

export class SerialTaskList extends TaskList {
  ordering = TaskListOrdering.SERIAL;
}

export class ParallelTaskList extends TaskList {
  ordering = TaskListOrdering.PARALLEL;

  async run(overrides?: TaskInput) {
    this.emit("start");

    this.input = this.withDefaults(overrides);
    let taskInput = {};

    const total = this.tasks.length;
    await Promise.all(
      this.tasks.map(async (task) => {
        await task.run(taskInput);
        this.emit("progress", this.completed / total);
      })
    );

    const outputs = this.tasks.map((task) => task.output || {}) || [];
    const result: TaskInput = {};
    outputs.forEach((item) => {
      Object.keys(item).forEach((key) => {
        if (!result[key]) {
          result[key] = [];
        }
        result[key].push(item[key]);
      });
    });

    this.output = result;
    if (this.errors === total) this.emit("error", this.error);
    this.emit("complete");
    return this.output;
  }
}

// ===============================================================================

export abstract class Strategy extends MultiTaskBase {
  declare id: string;
  readonly kind = "STRATEGY";
  ordering = TaskListOrdering.SERIAL;
  constructor(config: TaskConfig = {}, defaults: TaskInput = {}) {
    super(config, [], defaults);
    this.generateTasks();
  }
  abstract generateTasks(): void;
}
