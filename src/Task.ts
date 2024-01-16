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
  input: any;
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
export type TaskEvents = "start" | "complete" | "error" | "progress";

export type StreamableTaskKind = "TASK" | "TASK_LIST" | "STRATEGY";

// ===============================================================================

abstract class TaskBase extends EventEmitter<TaskEvents> {
  id: unknown;
  name: string;
  input: any;
  #output: any;
  status: TaskStatus = TaskStatus.PENDING;
  progress: number = 0;
  createdAt: Date = new Date();
  completedAt: Date | null = null;
  error: string | undefined = undefined;
  constructor(input: Partial<ITask> & Pick<ITask, "name">) {
    super();
    this.input = input;
    this.name = input.name;
    this.id = input.id;
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
  get output(): any {
    return this.#output;
  }
  set output(val: any) {
    this.#output = val;
  }

  abstract run(): Promise<void>;
}

export abstract class MultiTaskBase extends TaskBase {
  tasks: TaskStream = [];
  get output(): any[] {
    return this.tasks.map((task) => {
      return { output: task.output, name: task.name };
    });
  }

  constructor(
    input: Partial<ITaskList | IStrategy> &
      Pick<ITaskList | IStrategy, "name" | "tasks">
  ) {
    super(input);
    this.tasks = input.tasks;
    const total = this.tasks.length;
    let completed = 0;
    let errors = 0;
    this.tasks.forEach((task) => {
      task.on("start", () => {
        if (this.status === TaskStatus.PENDING) {
          this.emit("start");
        }
      });
      task.on("complete", () => {
        completed++;
        if (completed === total) {
          if (errors === 0) {
            this.emit("complete");
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

export abstract class Task extends TaskBase implements ITask {
  readonly kind = "TASK";
  public job_id: unknown;
}

export class LambdaTask extends Task {
  #runner: () => Promise<void>;
  constructor(
    input: Partial<ITask> & Pick<ITask, "name"> & { run: () => Promise<void> }
  ) {
    super(input);
    this.#runner = input.run;
  }
  async run() {
    this.emit("start");
    await this.#runner();
    this.emit("complete");
  }
}

export abstract class TaskList extends MultiTaskBase implements ITask {
  readonly kind = "TASK_LIST";
  ordering: "serial" | "parallel" = "serial";
  constructor(
    input: Partial<ITaskList> & Pick<ITaskList, "name" | "ordering" | "tasks">
  ) {
    const { ordering = "serial", ...rest } = input;
    super(rest);
    this.ordering = input.ordering;
  }
}

// ===============================================================================

export class SerialTaskList extends TaskList {
  constructor(input: Partial<ITaskList> & Pick<ITaskList, "name" | "tasks">) {
    super({ ...input, ordering: "serial" });
  }
  async run() {
    const total = this.tasks.length;
    let completed = 0;
    for (const task of this.tasks) {
      const taskwait = new Promise((resolve) => {
        task.on("complete", resolve);
        task.on("error", resolve);
      });
      task.run();
      await taskwait;
      completed++;
      this.emit("progress", completed / total);
    }
  }
}

export class ParallelTaskList extends TaskList {
  constructor(input: Partial<ITaskList> & Pick<ITaskList, "name" | "tasks">) {
    super({ ...input, ordering: "parallel" });
  }
  async run() {
    const total = this.tasks.length;
    let completed = 0;
    await Promise.all(
      this.tasks.map(async (task) => {
        const taskwait = new Promise((resolve) => {
          task.on("complete", resolve);
          task.on("error", resolve);
        });
        task.run();
        await taskwait;
        completed++;
        this.emit("progress", completed / total);
      })
    );
  }
}

// ===============================================================================

export class Strategy extends MultiTaskBase implements ITask {
  readonly kind = "STRATEGY";
  constructor(input: Partial<IStrategy> & Pick<IStrategy, "name" | "tasks">) {
    super(input);
  }
  async run() {
    const total = this.tasks.length;
    let completed = 0;
    for (const task of this.tasks) {
      const taskwait = new Promise((resolve) => {
        task.on("complete", resolve);
        task.on("error", resolve);
      });
      task.run();
      await taskwait;
      completed++;
      this.emit("progress", completed / total);
    }
  }
}

export type TaskStreamable = Task | TaskList | Strategy;
export type TaskStream = TaskStreamable[];
