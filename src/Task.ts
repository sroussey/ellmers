import { EventEmitter } from "eventemitter3";

export enum TaskStatus {
  PENDING = "NEW",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

export interface ITask {
  id: unknown;
  name: string;
  payload: any;
  status: TaskStatus;
  progress: number;
  createdAt: Date;
  completedAt: Date | null;
  error: string | undefined;
}

export interface ITaskList extends ITask {
  tasks: Task[];
  ordering: "serial" | "parallel";
}

export interface IStrategy extends ITask {
  tasks: TaskStream;
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
export type TaskEvents = "start" | "end" | "error" | "progress";

// ===============================================================================

abstract class TaskBase extends EventEmitter<TaskEvents> {
  id: unknown;
  name: string;
  payload: any;
  status: TaskStatus = TaskStatus.PENDING;
  progress: number = 0;
  createdAt: Date = new Date();
  completedAt: Date | null = null;
  error: string | undefined = undefined;
  constructor(options: Partial<ITask> & Pick<ITask, "name">) {
    super();
    this.name = options.name;
    this.id = options.id;
    this.payload = options.payload;
    this.on("start", () => {
      this.status = TaskStatus.PROCESSING;
    });
    this.on("end", () => {
      this.completedAt = new Date();
      this.status = TaskStatus.COMPLETED;
    });
    this.on("error", (error) => {
      this.completedAt = new Date();
      this.status = TaskStatus.FAILED;
      this.error = error;
    });
  }
  abstract run(): Promise<void>;
}

export abstract class MultiTaskBase extends TaskBase {
  tasks: TaskStream = [];

  constructor(
    options: Partial<ITaskList | IStrategy> &
      Pick<ITaskList | IStrategy, "name" | "tasks">
  ) {
    super(options);
    this.tasks = options.tasks;
    const total = this.tasks.length;
    let completed = 0;
    let errors = 0;
    this.tasks.forEach((task) => {
      task.on("start", () => {
        if (this.status === TaskStatus.PENDING) {
          this.emit("start");
        }
      });
      task.on("end", () => {
        completed++;
        if (completed === total) {
          if (errors === 0) {
            this.emit("end");
          } else {
            this.emit("error", this.error);
          }
        }
      });
      task.on("error", (error) => {
        completed++;
        errors++;
        this.error = this.error ? this.error + " & " + error : error;
        if (completed === total) {
          this.emit("error", this.error);
        }
      });
    });
  }
}

// ===============================================================================

export type StreamableTaskKind = "TASK" | "TASK_LIST" | "STRATEGY";

export abstract class Task extends TaskBase implements ITask {
  readonly kind = "TASK";
}

export class LambdaTask extends Task {
  #runner: () => Promise<void>;
  constructor(
    options: Partial<ITask> & Pick<ITask, "name"> & { run: () => Promise<void> }
  ) {
    super(options);
    this.#runner = options.run;
  }
  async run() {
    await this.#runner();
  }
}

export abstract class TaskList extends MultiTaskBase implements ITask {
  readonly kind = "TASK_LIST";
  ordering: "serial" | "parallel" = "serial";
  constructor(
    options: Partial<ITaskList> & Pick<ITaskList, "name" | "ordering" | "tasks">
  ) {
    const { ordering = "serial", ...rest } = options;
    super(rest);
    this.ordering = options.ordering;
  }
}

export class Strategy extends MultiTaskBase implements ITask {
  readonly kind = "STRATEGY";
  constructor(options: Partial<IStrategy> & Pick<IStrategy, "name" | "tasks">) {
    super(options);
  }
  async run() {
    const total = this.tasks.length;
    let completed = 0;
    for (const task of this.tasks) {
      await task.run();
      completed++;
      this.emit("progress", completed / total);
    }
  }
}

// ===============================================================================

export class SerialTaskList extends TaskList {
  constructor(options: Partial<ITaskList> & Pick<ITaskList, "name" | "tasks">) {
    super({ ...options, ordering: "serial" });
  }
  async run() {
    const total = this.tasks.length;
    let completed = 0;
    for (const task of this.tasks) {
      await task.run();
      completed++;
      this.emit("progress", completed / total);
    }
  }
}

export class ParallelTaskList extends TaskList {
  constructor(options: Partial<ITaskList> & Pick<ITaskList, "name" | "tasks">) {
    super({ ...options, ordering: "parallel" });
  }
  async run() {
    await Promise.all(this.tasks.map((task) => task.run()));
  }
}

export type TaskStreamable = Task | TaskList | Strategy;
export type TaskStream = TaskStreamable[];
