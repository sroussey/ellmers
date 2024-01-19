//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { EventEmitter } from "eventemitter3";

/**
 * WARNING!
 * TODO!
 *
 * Task input and output is not type safe. It is super brittle and hacky. There is no way to tranform between
 * between them. Input and output are dictionaries, so right now an output of `text` will overwrite an input of `text`.
 * But those overwrites are at runtime AFTER the tasks are created. This is because everything happens in the
 * constructor because I was lazy and not sure what I wanted. I still don't. I am thinking about a visual
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
 * Note that events(start|end|error) bubble up from subtasks to parent tasks.
 *
 * This may seem odd, but think of the leaf tasks getting sent to queue of
 * workers for processing. The parent task doesn't really start uptil a child
 * has been posted to the queue and gets picked up by a worker. Only then does
 * that task start, and thus its parent task starts.
 *
 * There is no job queue at the moement, but this is the idea.
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
}

export interface TaskInput {
  [key: string]: any;
}

abstract class TaskBase extends EventEmitter<TaskEvents> {
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
  config: TaskConfig = {};
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
    super();
    this.defaults = defaults;
    this.input = this.withDefaults();
    this.config = config;
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

// ===============================================================================

export abstract class Task extends TaskBase {
  readonly kind = "TASK";
}

export class LambdaTask extends Task {
  #runner: (input: TaskInput) => Promise<TaskInput>;
  constructor(
    config: TaskConfig & {
      run: () => Promise<TaskInput>;
    },
    input: TaskInput = {}
  ) {
    super(config, input);
    this.#runner = config.run;
  }
  async run(overrides?: TaskInput) {
    this.emit("start");
    this.input = this.withDefaults<TaskInput>(overrides);
    this.output = await this.#runner(this.input);
    this.emit("complete");
    return this.output;
  }
}

// ===============================================================================

export abstract class MultiTaskBase extends TaskBase {
  tasks: TaskStream = [];
  protected started = 0;
  protected completed = 0;
  protected total = 0;
  protected errors = 0;

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

  constructor(
    config: Partial<TaskConfig> = {},
    tasks: TaskStream = [],
    defaults: TaskInput = {}
  ) {
    super(config, defaults);
    this.setTasks(tasks);
  }

  async run(overrides?: TaskInput) {
    this.emit("start");
    this.input = this.withDefaults(overrides);
    // TODO: dont regenerate if defaults are the same as input
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
      taskInput = this.withDefaults(this.input, task.output);
      this.emit("progress", this.completed / total);
      if (this.errors) {
        this.emit("error", this.error);
        break;
      }
    }
    this.emit("complete");
    return this.output;
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
  ordering = "serial";
}

export class ParallelTaskList extends TaskList {
  ordering = "parallel";

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

export class Strategy extends MultiTaskBase {
  readonly kind = "STRATEGY";
  odering = "serial";
  constructor(config: TaskConfig = {}, defaults: TaskInput = {}) {
    super(config, [], defaults);
    this.generateTasks();
  }
}
