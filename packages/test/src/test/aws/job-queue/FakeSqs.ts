/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  SendMessageBatchCommand,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { uuid4 } from "@workglow/util";
import { mockClient, type AwsClientStub } from "aws-sdk-client-mock";

interface FakeMessage {
  readonly messageId: string;
  /** Wall-clock ms of first ReceiveMessage delivery; undefined until first delivered. */
  firstReceivedAt: number | undefined;
  body: string;
  receiptHandle: string;
  visibleAt: number;
}

/**
 * In-memory SQS double with visibility-timeout-faithful semantics. Wraps
 * `aws-sdk-client-mock` so a real `SQSClient` instance can be driven from
 * adapter code without any network calls.
 */
export class FakeSqs {
  public readonly client: SQSClient;
  private readonly messages: FakeMessage[] = [];
  private readonly mock: AwsClientStub<SQSClient>;

  constructor() {
    this.client = new SQSClient({ region: "us-east-1" });
    this.mock = mockClient(this.client);
    this.wire();
  }

  reset(): void {
    this.messages.length = 0;
    this.mock.reset();
    this.wire();
  }

  /** Visible message count (excludes in-flight ones whose visibility hasn't elapsed). */
  visibleCount(): number {
    const now = Date.now();
    return this.messages.filter((m) => m.visibleAt <= now).length;
  }

  /** Total message count, regardless of visibility. */
  totalCount(): number {
    return this.messages.length;
  }

  private wire(): void {
    this.mock.on(SendMessageCommand).callsFake((input) => {
      const id = uuid4();
      const now = Date.now();
      this.messages.push({
        messageId: id,
        firstReceivedAt: undefined,
        body: input.MessageBody ?? "",
        receiptHandle: uuid4(),
        visibleAt: now + (input.DelaySeconds ?? 0) * 1000,
      });
      return { MessageId: id };
    });

    this.mock.on(SendMessageBatchCommand).callsFake((input) => {
      const entries = (input.Entries ?? []) as Array<{
        Id: string;
        MessageBody: string;
        DelaySeconds?: number;
      }>;
      const successful = entries.map((e) => {
        const id = uuid4();
        const now = Date.now();
        this.messages.push({
          messageId: id,
          firstReceivedAt: undefined,
          body: e.MessageBody ?? "",
          receiptHandle: uuid4(),
          visibleAt: now + (e.DelaySeconds ?? 0) * 1000,
        });
        return { Id: e.Id, MessageId: id };
      });
      return { Successful: successful, Failed: [] };
    });

    this.mock.on(ReceiveMessageCommand).callsFake((input) => {
      const now = Date.now();
      const max = input.MaxNumberOfMessages ?? 1;
      const visTimeout = input.VisibilityTimeout ?? 30;
      const picked: FakeMessage[] = [];
      for (const m of this.messages) {
        if (picked.length >= max) break;
        if (m.visibleAt <= now) {
          m.visibleAt = now + visTimeout * 1000;
          m.receiptHandle = uuid4();
          if (m.firstReceivedAt === undefined) m.firstReceivedAt = now;
          picked.push(m);
        }
      }
      return {
        Messages: picked.map((m) => ({
          MessageId: m.messageId,
          Body: m.body,
          ReceiptHandle: m.receiptHandle,
          Attributes: { ApproximateFirstReceiveTimestamp: String(m.firstReceivedAt ?? now) },
        })),
      };
    });

    this.mock.on(DeleteMessageCommand).callsFake((input) => {
      const idx = this.messages.findIndex((m) => m.receiptHandle === input.ReceiptHandle);
      if (idx >= 0) this.messages.splice(idx, 1);
      return {};
    });

    this.mock.on(ChangeMessageVisibilityCommand).callsFake((input) => {
      const m = this.messages.find((x) => x.receiptHandle === input.ReceiptHandle);
      if (m) m.visibleAt = Date.now() + (input.VisibilityTimeout ?? 0) * 1000;
      return {};
    });
  }
}
