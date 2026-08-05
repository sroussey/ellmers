/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseError } from "@workglow/util";

/** Base class for every error raised by the triggers package. */
export class TriggerError extends BaseError {
  public static override type = "TriggerError";
}

/** Raised when a trigger is constructed or started with invalid options. */
export class TriggerConfigurationError extends TriggerError {
  public static override type = "TriggerConfigurationError";
}

/** Raised when a cron expression cannot be parsed. */
export class CronExpressionError extends TriggerError {
  public static override type = "CronExpressionError";
}

/**
 * Raised when a syntactically valid cron expression matches no instant within
 * the search horizon (for example `0 0 30 2 *` — February never has 30 days).
 */
export class CronUnsatisfiableError extends TriggerError {
  public static override type = "CronUnsatisfiableError";
}

/** Raised by the `Workflow.trigger()` / `Workflow.listen()` bindings. */
export class WorkflowTriggerError extends TriggerError {
  public static override type = "WorkflowTriggerError";
}
