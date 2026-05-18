/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IClaim } from "./IClaim";
import type { QueueChangePayload, QueueStorageScope, QueueSubscribeOptions } from "./IQueueStorage";

export type MessageId = unknown;

/**
 * Options for sending a message to the queue.
 */
export interface SendOptions {
  readonly delaySeconds?: number;
  readonly timeoutSeconds?: number;
  readonly fingerprint?: string;
  readonly jobRunId?: string;
  readonly maxAttempts?: number;
}

/**
 * Message queue interface — owns producing and consuming messages.
 * Pairs with {@link IJobStore} for read-side / mutation access to the
 * stored job record.
 */
export interface IMessageQueue<Body> {
  readonly scope: QueueStorageScope;
  send(body: Body, opts?: SendOptions): Promise<MessageId>;
  sendBatch(bodies: readonly Body[], opts?: SendOptions): Promise<readonly MessageId[]>;
  receive(opts: {
    workerId: string;
    leaseMs: number;
    max?: number;
  }): Promise<readonly IClaim<Body>[]>;
  releaseClaim(id: MessageId): Promise<void>;
  migrate(): Promise<void>;
  getMigrations(): ReadonlyArray<unknown>;
  subscribeToChanges?(
    callback: (change: QueueChangePayload<any, any>) => void,
    options?: QueueSubscribeOptions
  ): () => void;
}
