export enum TaskStatus {
  PENDING = "NEW",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

export interface Task {
  id: unknown;
  name: string;
  payload: any;
  status: TaskStatus;
  createdAt: Date;
  completedAt: Date;
  error: string;
}

export interface TaskList extends Task {
  tasks: Task[];
}

export interface Strategy {
  id: unknown;
  name: string;
  payload: any;
}
