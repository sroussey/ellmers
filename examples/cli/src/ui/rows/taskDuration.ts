/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

interface TaskTimestamps {
  readonly startedAt?: Date;
  readonly completedAt?: Date;
}

/**
 * Wall-clock a settled row reports in its trailing column, or `undefined`
 * while the task is still open — the column shows percentage then.
 *
 * A `completedAt` older than `startedAt` is a leftover from a previous run of a
 * reused node, not a close, so it reports nothing rather than a negative span.
 */
export function settledTaskDurationMs(task: TaskTimestamps | undefined): number | undefined {
  const started = task?.startedAt;
  const completed = task?.completedAt;
  if (!started || !completed) return undefined;
  const ms = completed.getTime() - started.getTime();
  return ms >= 0 ? ms : undefined;
}
