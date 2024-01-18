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

export interface TaskListConfig extends TaskConfig {
  ordering: "serial" | "parallel";
}

export interface TaskInput {
  [key: string]: any;
}

abstract class TaskBase extends EventEmitter<TaskEvents> {
  id?: unknown;
  name?: string;
  input: TaskInput = {};
  output: TaskInput = {};
  status: TaskStatus = TaskStatus.PENDING;
  progress: number = 0;
  createdAt: Date = new Date();
  completedAt: Date | null = null;
  error: string | undefined = undefined;
  constructor(config: TaskConfig, input: TaskInput = {}) {
    super();
    this.input = input;
    this.name = config.name;
    this.id = config.id;
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

  abstract run(input?: TaskInput): Promise<TaskInput>;
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
  async run(input?: TaskInput) {
    this.emit("start");
    input = Object.assign({}, this.input, input);
    this.output = await this.#runner(input);
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

  constructor(
    config: Partial<TaskListConfig>,
    tasks: TaskStream,
    input: TaskInput = {}
  ) {
    super(config, input);
    this.tasks = tasks;
    this.tasks.forEach((task) => {
      task.on("start", () => {
        if (this.status === TaskStatus.PENDING) {
          this.emit("start");
        }
      });
      task.on("complete", () => {
        this.completed++;
      });
      task.on("error", (error) => {
        this.completed++;
        this.errors++;
        this.error = this.error ? this.error + " & " + error : error;
      });
    });
  }
}

export abstract class TaskList extends MultiTaskBase {
  readonly kind = "TASK_LIST";
  declare tasks: Task[];
  ordering: "serial" | "parallel" = "serial";
  constructor(
    config: Partial<TaskListConfig>,
    tasks: Task[],
    input: TaskInput = {}
  ) {
    const { ordering = "serial" } = config;
    super(config, tasks, input);
    this.ordering = ordering;
  }
}

export class SerialTaskList extends TaskList {
  constructor(
    config: Partial<TaskListConfig>,
    tasks: Task[],
    input: TaskInput = {}
  ) {
    super({ ...config, ordering: "serial" }, tasks, input);
  }
  async run(input?: TaskInput) {
    this.emit("start");
    const total = this.tasks.length;
    input = Object.assign({}, this.input, input);
    for (const task of this.tasks) {
      await task.run(input);
      if (this.tasks[this.tasks.length - 1] == task) {
        // if last task, their result is our result
        this.output = task.output;
        break;
      }
      if (this.errors) {
        this.emit("error", this.error);
        break;
      }
      input = Object.assign({}, input, task.output);
      this.emit("progress", this.completed / total);
    }
    this.emit("complete");
    return this.output;
  }
}

export class ParallelTaskList extends TaskList {
  constructor(config: TaskConfig, tasks: Task[], input: TaskInput = {}) {
    super({ ...config, ordering: "parallel" }, tasks, input);
  }
  async run(input?: TaskInput) {
    this.emit("start");

    input = Object.assign({}, this.input, input);

    const total = this.tasks.length;
    await Promise.all(
      this.tasks.map(async (task) => {
        await task.run(input);
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
    if (this.errors == total) this.emit("error", this.error);
    this.emit("complete");
    return this.output;
  }
}

// ===============================================================================

export class Strategy extends MultiTaskBase {
  readonly kind = "STRATEGY";
  constructor(config: TaskConfig, tasks: TaskStream, input: TaskInput = {}) {
    super(config, tasks, input);
  }
  async run(input?: TaskInput) {
    this.emit("start");
    const total = this.tasks.length;
    input = Object.assign({}, this.input, input);
    for (const task of this.tasks) {
      await task.run(input);
      if (this.tasks[this.tasks.length - 1] == task) {
        // if last task, their result is our result
        this.output = task.output;
      }
      if (this.errors) {
        this.emit("error", this.error);
        break;
      }
      input = Object.assign({}, input, task.output);
      this.emit("progress", this.completed / total);
    }
    this.emit("complete");
    return this.output;
  }
}
