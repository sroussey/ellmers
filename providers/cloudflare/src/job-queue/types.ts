/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IJobStore } from "@workglow/job-queue";

/**
 * Envelope written to a Cloudflare Queue. Carries only the job id (plus
 * lightweight metadata) — the full job record lives in the `IJobStore`.
 */
export interface CloudMessageBody {
  readonly id: string;
  readonly attempts: number;
  readonly deadlineAt?: number;
}

/** Constructor options for {@link CloudflareMessageQueue}. */
export interface CloudflareQueueOptions<Input, Output> {
  /** Producer-side binding from your Worker's `env.QUEUE`. */
  readonly queue: Queue<CloudMessageBody>;
  /** Queue name used for fingerprint scoping. */
  readonly queueName: string;
  readonly jobStore: IJobStore<Input, Output>;
}
