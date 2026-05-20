/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CloudMessageBody } from "@workglow/cloudflare/job-queue";
import { uuid4 } from "@workglow/util";

interface PendingMessage {
  readonly id: string;
  readonly body: CloudMessageBody;
  acked: boolean;
  retried: boolean;
}

/**
 * In-memory stand-in for a Cloudflare Queues producer binding. The producer
 * side (`send` / `sendBatch`) pushes envelopes into an internal backlog;
 * `drain(max)` pulls them back out as a `MessageBatch`-shaped object suitable
 * for feeding to `handleQueueBatch`.
 */
export class FakeQueueBinding {
  private readonly pending: PendingMessage[] = [];

  readonly queue: Queue<CloudMessageBody> = {
    send: async (body: CloudMessageBody, _opts?: { delaySeconds?: number }) => {
      this.pending.push({
        id: uuid4(),
        body,
        acked: false,
        retried: false,
      });
    },
    sendBatch: async (messages: Iterable<MessageSendRequest<CloudMessageBody>>) => {
      for (const m of messages) {
        this.pending.push({
          id: uuid4(),
          body: m.body as CloudMessageBody,
          acked: false,
          retried: false,
        });
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as Queue<CloudMessageBody>;

  /** Pull up to `max` unacked messages as a `MessageBatch` for `handleQueueBatch`. */
  drain(max: number = 100): MessageBatch<CloudMessageBody> {
    const slice = this.pending
      .filter((p) => !p.acked)
      .slice(0, max)
      .map((p) => ({
        id: p.id,
        body: p.body,
        timestamp: new Date(),
        attempts: 1,
        ack: () => {
          p.acked = true;
        },
        retry: (_opts?: { delaySeconds?: number }) => {
          p.retried = true;
        },
      }));
    return {
      messages: slice,
      queue: "fake",
      ackAll: () => slice.forEach((m) => m.ack()),
      retryAll: () => slice.forEach((m) => m.retry()),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as unknown as MessageBatch<CloudMessageBody>;
  }

  inspect(): readonly Readonly<PendingMessage>[] {
    return this.pending;
  }
}
