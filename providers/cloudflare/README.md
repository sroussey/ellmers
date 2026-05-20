# @workglow/cloudflare

Cloudflare backends for [@workglow/job-queue](https://www.npmjs.com/package/@workglow/job-queue).

Currently exposes a `CloudflareMessageQueue` adapter for [Cloudflare Queues](https://developers.cloudflare.com/queues/), paired with a `handleQueueBatch` helper that drives `JobQueueWorker.processClaims` from a Worker's `queue()` handler.

## Install

```sh
bun add @workglow/cloudflare @cloudflare/workers-types
```

`@workglow/job-queue` is a peer dependency. You also need a cluster-safe `IJobStore` implementation (e.g. the Postgres or Supabase backend from `@workglow/postgres` / `@workglow/supabase`) that every Worker isolate can reach.

## Usage

Cloudflare Queues are push-only: the runtime delivers messages to your Worker's `queue()` handler, not the other way around. Producers call `messageQueue.send()` from inside `fetch()`; consumers call `handleQueueBatch()` from inside `queue()`.

```ts
import { createCloudflareQueue, handleQueueBatch } from "@workglow/cloudflare/job-queue";
import { Job, JobQueueWorker } from "@workglow/job-queue";
import { createMyJobStore } from "./my-job-store"; // cluster-safe IJobStore

class MyJob extends Job<{ value: string }, { result: string }> {
  async execute(input: { value: string }) {
    return { result: input.value.toUpperCase() };
  }
}

export interface Env {
  QUEUE: Queue;
  // ...your DB bindings used by the IJobStore
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const jobStore = createMyJobStore(env);
    const { messageQueue } = createCloudflareQueue<{ value: string }, { result: string }>({
      queue: env.QUEUE,
      queueName: "my-queue",
      jobStore,
    });

    const { value } = await req.json();
    const id = await messageQueue.send(
      { input: { value }, status: "PENDING" } as never
    );
    return Response.json({ id });
  },

  async queue(batch: MessageBatch, env: Env): Promise<void> {
    const jobStore = createMyJobStore(env);
    const worker = new JobQueueWorker(MyJob, {
      messageQueue: createCloudflareQueue({
        queue: env.QUEUE,
        queueName: "my-queue",
        jobStore,
      }).messageQueue,
      jobStore,
      queueName: "my-queue",
      // REQUIRED: Cloudflare Queues do not expose a lease-extension API.
      extendLeaseWhileRunning: false,
    });
    await handleQueueBatch(batch, worker, jobStore);
  },
};
```

## Constraints

- **30-second visibility window.** Each `queue()` invocation must finish (ack/fail/retry every message) within the per-batch visibility window. Size your jobs accordingly.
- **`extendLeaseWhileRunning: false` is required.** Cloudflare Queues have no lease-extension API. Calling `claim.extendLease()` throws.
- **`subscribeToChanges` is unsupported.** Workers cannot subscribe to change notifications from a CFQ binding.
- **`receive()` throws.** Cloudflare Queues are push-only; there is no pull API. Drive processing through `handleQueueBatch` inside `queue()` rather than the polling `JobQueueWorker.start()` loop.
- **Fingerprint deduplication.** Performed uniformly through the supplied `IJobStore.findActiveByFingerprint` — same semantics as every other backend.

## Backpressure

Cloudflare's runtime governs consumer concurrency via `max_concurrency` (and related settings) in your `wrangler.toml`:

```toml
[[queues.consumers]]
queue = "my-queue"
max_batch_size = 10
max_batch_timeout = 5
max_concurrency = 4
max_retries = 3
dead_letter_queue = "my-queue-dlq"
```

Use those knobs to shape backpressure. Workglow's `ILimiter` still applies on top — but for cluster-wide enforcement pair it with a cluster-scoped limiter store (Postgres/Supabase). A process-scoped limiter on a cluster-scoped queue enforces the limit per isolate, not globally.

## Application-level dead-letter queue

Cloudflare's built-in `dead_letter_queue` in `wrangler.toml` is the most reliable DLQ for CFQ. If you want a Workglow-managed DLQ in addition (e.g. to ship exhausted jobs to a SQS queue you already drain elsewhere), plug another `IMessageQueue` into `JobQueueServer`/`JobQueueWorker.deadLetter`:

```ts
const dlq = createCloudflareQueue({ queue: env.DLQ, queueName: "my-queue-dlq", jobStore });

const worker = new JobQueueWorker(MyJob, {
  messageQueue,
  jobStore,
  queueName: "my-queue",
  extendLeaseWhileRunning: false,
  deadLetter: dlq.messageQueue,
});
```

The same shape works with `createSqsQueue` from `@workglow/aws` if you want a cross-cloud DLQ.

## License

Apache-2.0
