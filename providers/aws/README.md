# @workglow/aws

AWS backends for [`@workglow/job-queue`](../../packages/job-queue). Currently ships an Amazon SQS adapter that implements `IMessageQueue` so SQS can be paired with any `IJobStore` (e.g. Postgres) under a `JobQueueServer`.

## Install

```sh
bun add @workglow/aws @aws-sdk/client-sqs
```

`@aws-sdk/client-sqs` is a peer dependency. `@workglow/job-queue` and `@workglow/util` are also peers and are expected to already be installed.

## Usage

Compose an SQS message queue with a Postgres-backed job store:

```ts
import { SQSClient } from "@aws-sdk/client-sqs";
import { createSqsQueue } from "@workglow/aws/job-queue";
import { JobQueueServer } from "@workglow/job-queue";
import { createPostgresQueue } from "@workglow/postgres/job-queue";
import { MyJob } from "./MyJob";

const sqs = new SQSClient({ region: "us-east-1" });
const { jobStore } = createPostgresQueue("my-queue", pool);

const { messageQueue } = createSqsQueue({
  sqs,
  queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/my-queue",
  queueName: "my-queue",
  jobStore,
});

const server = new JobQueueServer(MyJob, {
  messageQueue,
  jobStore,
  queueName: "my-queue",
  // SQS has no push-notification surface — workers poll at this interval.
  pollIntervalMs: 250,
});

await server.start();
```

`createSqsQueue` returns `{ messageQueue, jobStore }`. The same `jobStore` you pass in is returned for convenience; pass either pair into `JobQueueServer`, `JobQueueWorker`, and `JobQueueClient`.

## Constraints

The SQS adapter intentionally surfaces SQS's native limits rather than papering over them:

- **`delaySeconds` ≤ 900.** SQS's `DelaySeconds` ceiling is 15 minutes. For longer scheduling windows, store the target time in the `JobStore` and re-publish from an external scheduler.
- **`extendLease` max 12 hours from original send.** SQS's `ChangeMessageVisibility` total cannot exceed 12 hours from the message's first receive. Long-running jobs that exceed this should checkpoint progress to the job store and resume on redelivery.
- **`subscribeToChanges` unsupported.** SQS has no INSERT/UPDATE/DELETE change-feed. Workers wake on the poll interval (`pollIntervalMs`). Set a tight interval (e.g. 250 ms) for latency-sensitive workloads, or use SQS long-polling at the SDK level for cost-efficient blocking receives.
- **Fingerprint dedup is uniform via `IJobStore.findActiveByFingerprint`.** SQS-native `MessageDeduplicationId` is FIFO-only and not used by this adapter; dedup is enforced uniformly through the job store, identical to every other `@workglow/job-queue` backend.
- **Native SQS DLQ vs. application-level DLQ.** SQS queue redrive policies (configured on the queue, not in this adapter) move messages to a DLQ queue after a configured number of receives. This is orthogonal to `JobQueueServer.deadLetter` — the latter is application-level dead-lettering driven by `maxAttempts` and `PermanentJobError`, and writes a terminal `FAILED` row to the `IJobStore`. Both can be used together.

## Application-level dead-lettering

To route exhausted jobs to a second SQS queue, stand up a second `createSqsQueue` instance pointing at the DLQ queue URL and wire it as the `deadLetter` target:

```ts
const dlq = createSqsQueue({
  sqs,
  queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/my-queue-dlq",
  queueName: "my-queue-dlq",
  jobStore: dlqJobStore,
});

const server = new JobQueueServer(MyJob, {
  messageQueue,
  jobStore,
  queueName: "my-queue",
  pollIntervalMs: 250,
  deadLetter: (job) => dlq.messageQueue.send(job),
});
```

This pattern is fully orthogonal to the SQS-native redrive policy and is preferred when the dead-letter pipeline needs custom routing, enrichment, or alerting logic.

## License

Apache-2.0
