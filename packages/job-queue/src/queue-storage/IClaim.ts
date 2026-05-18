/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageId } from "./IMessageQueue";

export type { MessageId };

/**
 * A claim on a message from the queue.
 *
 * A claim is created when a worker calls {@link IMessageQueue.receive}. It
 * represents an exclusive (leased) right to process the message. The worker
 * must terminate the claim via one of {@link IClaim.ack},
 * {@link IClaim.retry}, or {@link IClaim.fail}, or by letting the lease
 * expire.
 */
export interface IClaim<Body> {
  readonly id: MessageId;
  readonly body: Body;
  readonly attempts: number;
  /** Mark the message as successfully processed (terminal). */
  ack(): Promise<void>;
  /** Release the claim and reschedule for a later attempt. */
  retry(opts?: { delaySeconds?: number }): Promise<void>;
  /** Mark the message as failed (terminal). */
  fail(opts?: { permanent?: boolean }): Promise<void>;
  /** Extend the lease by `ms` milliseconds. */
  extendLease(ms: number): Promise<void>;
}
