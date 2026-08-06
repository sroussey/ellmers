/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JobError } from "@workglow/job-queue";
import { BaseError } from "@workglow/util";

export class TaskError extends BaseError {
  static override readonly type: string = "TaskError";
  /** The type of the task that produced this error, if available. */
  public taskType?: string;
  /** The ID of the task that produced this error, if available. */
  public taskId?: unknown;
  constructor(message: string) {
    super(message);
  }
}

export class TaskConfigurationError extends TaskError {
  static override readonly type: string = "TaskConfigurationError";
  constructor(message: string) {
    super(message);
  }
}

export class WorkflowError extends TaskError {
  static override readonly type: string = "WorkflowError";
  constructor(message: string) {
    super(message);
  }
}

/**
 * A task error caused by a task being aborted (task.abort() or external signal).
 */
export class TaskAbortedError extends TaskError {
  static override readonly type: string = "TaskAbortedError";
  constructor(message: string = "Task aborted") {
    super(message);
  }
}

/**
 * A task error caused by exceeding `runConfig.timeout`.
 */
export class TaskTimeoutError extends TaskAbortedError {
  static override readonly type: string = "TaskTimeoutError";
  constructor(timeoutMs?: number) {
    super(timeoutMs ? `Task timed out after ${timeoutMs}ms` : "Task timed out");
  }
}

/**
 * Thrown when graph-level execution exceeds the configured `timeout` in
 * {@link TaskGraphRunConfig}. Distinct from {@link TaskTimeoutError} (which is
 * thrown for individual-task timeouts) so callers can tell whether the timeout
 * was on a single task or on the entire graph run.
 */
export class TaskGraphTimeoutError extends TaskTimeoutError {
  static override readonly type: string = "TaskGraphTimeoutError";
  constructor(timeoutMs?: number) {
    super(timeoutMs);
    // Override the message set by TaskTimeoutError to make it graph-specific.
    this.message = timeoutMs
      ? `Graph execution timed out after ${timeoutMs}ms`
      : "Graph execution timed out";
  }
}

export class TaskFailedError extends TaskError {
  static override readonly type: string = "TaskFailedError";
  constructor(message: string = "Task failed") {
    super(message);
  }
}

export class JobTaskFailedError extends TaskFailedError {
  static override readonly type: string = "JobTaskFailedError";
  public jobError: JobError;
  /** Machine-readable code when the underlying job error provides one (e.g. FETCH_HTTP_CLIENT_ERROR). */
  public code?: string;
  constructor(err: JobError) {
    super(String(err));
    this.jobError = err;
    if (err.code) {
      this.code = err.code;
    }
  }
}

export class TaskJSONError extends TaskError {
  static override readonly type: string = "TaskJSONError";
  constructor(message: string = "Error converting JSON to a Task") {
    super(message);
  }
}

export class TaskInvalidInputError extends TaskError {
  static override readonly type: string = "TaskInvalidInputError";
  constructor(message: string = "Invalid input data") {
    super(message);
  }
}

export class TaskEntitlementError extends TaskError {
  static override readonly type: string = "TaskEntitlementError";
  constructor(message: string = "Required entitlements denied") {
    super(message);
  }
}

/**
 * Thrown when toJSON is called on a task whose config contains non-serializable
 * values (e.g. functions). Tasks should override canSerializeConfig() to declare
 * whether they support serialization.
 */
export class TaskSerializationError extends TaskError {
  static override readonly type: string = "TaskSerializationError";
  constructor(taskType: string) {
    super(
      `Task "${taskType}" cannot be serialized: config contains non-serializable values. ` +
        `Use a declarative config alternative or remove function-valued config properties.`
    );
  }
}
