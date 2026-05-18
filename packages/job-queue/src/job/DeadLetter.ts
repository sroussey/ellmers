/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Payload written to the dead-letter queue when a job exhausts its retry budget.
 */
export interface DeadLetter<Input> {
  readonly original: Input;
  readonly error: string;
  readonly errorCode: string | null;
  readonly attempts: number;
  readonly queueName: string;
  readonly jobRunId: string | undefined;
}
