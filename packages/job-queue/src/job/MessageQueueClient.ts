/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageQueue, MessageId, SendOptions } from "../queue-storage/IMessageQueue";

/**
 * Thin producer-only client over an {@link IMessageQueue}. Use for
 * fire-and-forget message production where you don't need the {@link Job}
 * lifecycle abstractions in {@link JobQueueClient}.
 */
export class MessageQueueClient<Body> {
  private readonly messageQueue: IMessageQueue<Body>;

  constructor(opts: { readonly messageQueue: IMessageQueue<Body> }) {
    this.messageQueue = opts.messageQueue;
  }

  async send(body: Body, opts?: SendOptions): Promise<MessageId> {
    return this.messageQueue.send(body, opts);
  }

  async sendBatch(bodies: readonly Body[], opts?: SendOptions): Promise<readonly MessageId[]> {
    return this.messageQueue.sendBatch(bodies, opts);
  }
}
