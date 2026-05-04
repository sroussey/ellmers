<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Composite Rate Limiting

## Overview

The Workglow rate limiting system (`@workglow/job-queue/limiter`) provides a composable set of limiters that control how fast and how many jobs can execute within a queue. Rate limiting is critical when interacting with external APIs that enforce request quotas, when protecting shared infrastructure from overload, or when ensuring fair resource allocation across multiple queues.

The system is built around a single interface -- `ILimiter` -- that every limiter implements. Limiters can be used individually or combined into a `CompositeLimiter` that enforces all constraints simultaneously. The job queue worker checks the limiter before every job claim, and the limiter's lifecycle hooks (`recordJobStart`, `recordJobCompletion`) keep internal state synchronized with actual execution.

## The ILimiter Interface

Every limiter in the system implements this interface:

```typescript
interface ILimiter {
  canProceed(): Promise<boolean>;
  recordJobStart(): Promise<void>;
  recordJobCompletion(): Promise<void>;
  getNextAvailableTime(): Promise<Date>;
  setNextAvailableTime(date: Date): Promise<void>;
  clear(): Promise<void>;
}
```

### Method Semantics

| Method                       | Called By                   | Purpose                                                           |
| ---------------------------- | --------------------------- | ----------------------------------------------------------------- |
| `canProceed()`               | Worker (before claiming)    | Returns `true` if the limiter allows a new job to start right now |
| `recordJobStart()`           | Worker (after claiming)     | Notifies the limiter that a job has started executing             |
| `recordJobCompletion()`      | Worker (in `finally` block) | Notifies the limiter that a job has finished (success or failure) |
| `getNextAvailableTime()`     | Worker (when rescheduling)  | Returns the earliest `Date` at which the next job could execute   |
| `setNextAvailableTime(date)` | External callers            | Externally impose a delay (e.g., from a 429 Retry-After header)   |
| `clear()`                    | Cleanup / testing           | Resets the limiter to its initial state                           |

The worker integration is straightforward. In the `processJobs` loop:

```
while running:
    if limiter.canProceed():
        job = storage.next(workerId)
        if job:
            limiter.recordJobStart()
            try:
                execute(job)
            finally:
                limiter.recordJobCompletion()
    else:
        wait for notify or poll timeout
```

## NullLimiter

The default limiter when none is configured. It imposes no restrictions.

```typescript
import { NullLimiter } from "@workglow/job-queue";

const limiter = new NullLimiter();
await limiter.canProceed(); // always true
```

All methods are no-ops. `canProceed()` always returns `true`, and `getNextAvailableTime()` always returns `new Date()` (now). This is the limiter the server uses when no explicit limiter is provided.

## ConcurrencyLimiter

Controls the maximum number of jobs that can execute simultaneously. This is a pure in-memory limiter with no storage dependency.

```typescript
import { ConcurrencyLimiter } from "@workglow/job-queue";

const limiter = new ConcurrencyLimiter(5); // max 5 concurrent jobs
```

### How It Works

The limiter maintains a `currentRunningJobs` counter. `canProceed()` returns `true` only when this counter is below the configured maximum _and_ the current time is past any externally set `nextAllowedStartTime`. `recordJobStart()` increments the counter; `recordJobCompletion()` decrements it (with a floor of 0).

This limiter is ideal for controlling parallelism within a single process -- for example, limiting concurrent GPU inference tasks or database connections.

### Configuration

| Parameter           | Type     | Description                                       |
| ------------------- | -------- | ------------------------------------------------- |
| `maxConcurrentJobs` | `number` | Maximum number of jobs executing at the same time |

```typescript
const limiter = new ConcurrencyLimiter(3);

await limiter.canProceed(); // true (0 running)
await limiter.recordJobStart(); // 1 running
await limiter.recordJobStart(); // 2 running
await limiter.recordJobStart(); // 3 running
await limiter.canProceed(); // false (at capacity)
await limiter.recordJobCompletion(); // 2 running
await limiter.canProceed(); // true
```

## RateLimiter

A sliding-window rate limiter with exponential backoff and jitter. Unlike the `ConcurrencyLimiter`, this limiter uses an `IRateLimiterStorage` backend to persist execution timestamps, making it suitable for cross-process rate limiting.

```typescript
import { InMemoryRateLimiterStorage, RateLimiter } from "@workglow/job-queue";

const storage = new InMemoryRateLimiterStorage();
await storage.setupDatabase();

const limiter = new RateLimiter(storage, "openai-embeddings", {
  maxExecutions: 100,
  windowSizeInSeconds: 60,
  initialBackoffDelay: 1_000,
  backoffMultiplier: 2,
  maxBackoffDelay: 600_000,
});
```

### Sliding Window Algorithm

The limiter tracks individual execution timestamps in its storage backend. When `canProceed()` is called, it counts how many executions have occurred within the current window (`now - windowSizeInSeconds`). If the count is below `maxExecutions`, the job may proceed and any existing backoff is cleared.

When `recordJobStart()` detects that the window is full, it applies an exponential backoff delay with full jitter:

```
backoffDelay = min(currentBackoff * backoffMultiplier, maxBackoffDelay)
jitteredDelay = backoffDelay + random(0, backoffDelay)
nextAvailableTime = now + jitteredDelay
```

The jitter prevents thundering-herd problems when multiple workers hit the rate limit simultaneously. Each worker will retry at a slightly different time.

### IRateLimiterStorage

The `RateLimiter` delegates persistence to an `IRateLimiterStorage` implementation. Available backends include:

- `InMemoryRateLimiterStorage` -- Fast, single-process.
- `SqliteRateLimiterStorage` -- Persistent, single-machine.
- `PostgresRateLimiterStorage` -- Persistent, multi-machine.
- `IndexedDbRateLimiterStorage` -- Browser environments.
- `SupabaseRateLimiterStorage` -- Cloud-hosted PostgreSQL.

The storage interface provides:

```typescript
interface IRateLimiterStorage {
  setupDatabase(): Promise<void>;
  recordExecution(queueName: string): Promise<void>;
  getExecutionCount(queueName: string, windowStartTime: string): Promise<number>;
  getOldestExecutionAtOffset(queueName: string, offset: number): Promise<string | undefined>;
  getNextAvailableTime(queueName: string): Promise<string | undefined>;
  setNextAvailableTime(queueName: string, nextAvailableAt: string): Promise<void>;
  clear(queueName: string): Promise<void>;
}
```

### Configuration Reference

| Option                | Type     | Default    | Description                                   |
| --------------------- | -------- | ---------- | --------------------------------------------- |
| `maxExecutions`       | `number` | (required) | Maximum executions allowed per window         |
| `windowSizeInSeconds` | `number` | (required) | Length of the sliding window                  |
| `initialBackoffDelay` | `number` | `1000`     | Initial backoff delay in ms                   |
| `backoffMultiplier`   | `number` | `2`        | Multiplier applied on each successive backoff |
| `maxBackoffDelay`     | `number` | `600000`   | Maximum backoff delay (10 minutes)            |

## DelayLimiter

A simple limiter that enforces a minimum delay between consecutive job starts. It does not limit concurrency or track a window -- it simply prevents the next job from starting until a fixed interval has elapsed since the last `recordJobStart()`.

```typescript
import { DelayLimiter } from "@workglow/job-queue";

const limiter = new DelayLimiter(200); // 200ms between job starts
```

### How It Works

On `recordJobStart()`, the limiter sets `nextAvailableTime = now + delayInMilliseconds`. Subsequent calls to `canProceed()` return `false` until that time has passed. This is useful for inserting a small cooldown between requests to avoid burst behavior.

### Configuration

| Parameter             | Type     | Default | Description                              |
| --------------------- | -------- | ------- | ---------------------------------------- |
| `delayInMilliseconds` | `number` | `50`    | Minimum delay between consecutive starts |

## EvenlySpacedRateLimiter

A rate limiter that distributes job starts evenly across a time window, taking actual execution duration into account. Rather than allowing a burst of `maxExecutions` jobs and then blocking for the remainder of the window, this limiter spaces starts at regular intervals.

```typescript
import { EvenlySpacedRateLimiter } from "@workglow/job-queue";

const limiter = new EvenlySpacedRateLimiter({
  maxExecutions: 60,
  windowSizeInSeconds: 60,
});
// Ideal interval = 60s / 60 = 1 start per second
```

### Adaptive Spacing Algorithm

The ideal interval between starts is `windowSizeMs / maxExecutions`. However, if jobs take measurable time to complete, the limiter adjusts the wait time:

```
waitMs = max(0, idealInterval - averageDuration)
nextAvailableTime = now + waitMs
```

The limiter maintains a running window of the most recent `maxExecutions` job durations. `recordJobCompletion()` records the duration of the just-finished job. `recordJobStart()` uses the average of these durations to calculate the next available time.

This approach is ideal for API calls where you need a steady request rate rather than bursty behavior. For example, an API with a 60 RPM limit benefits from one request per second rather than 60 requests in the first second followed by 59 seconds of waiting.

### Configuration

| Option                | Type     | Description                           |
| --------------------- | -------- | ------------------------------------- |
| `maxExecutions`       | `number` | Maximum executions allowed per window |
| `windowSizeInSeconds` | `number` | Length of the time window             |

## CompositeLimiter

The `CompositeLimiter` combines multiple limiters using AND semantics: a job can only proceed if _every_ constituent limiter approves. This is the primary mechanism for layering different rate limiting strategies.

```typescript
import { CompositeLimiter, ConcurrencyLimiter, RateLimiter } from "@workglow/job-queue";

const limiter = new CompositeLimiter([
  new ConcurrencyLimiter(5),
  new RateLimiter(storage, "openai", {
    maxExecutions: 100,
    windowSizeInSeconds: 60,
  }),
]);
```

### How It Works

- **`canProceed()`** iterates through all limiters and returns `false` at the first one that denies. Short-circuit evaluation means expensive checks can be placed later in the list.
- **`recordJobStart()`** and **`recordJobCompletion()`** are forwarded to all limiters.
- **`getNextAvailableTime()`** returns the _latest_ (most restrictive) time across all limiters.
- **`setNextAvailableTime(date)`** is forwarded to all limiters.
- **`clear()`** clears all limiters.

### Dynamic Composition

Limiters can be added at runtime:

```typescript
const composite = new CompositeLimiter();
composite.addLimiter(new ConcurrencyLimiter(10));
composite.addLimiter(new DelayLimiter(100));
```

## Integration with the Job Queue

The limiter is passed to the `JobQueueServer` via the `limiter` option. The server passes it to every worker it creates. The worker consults the limiter in two places:

1. **Main processing loop:** Before calling `storage.next()`, the worker calls `limiter.canProceed()`. If the limiter denies, the worker waits for a wake signal or poll timeout.

2. **Job rescheduling:** When a `RetryableJobError` is caught and the job still has retries remaining, the worker calls `limiter.getNextAvailableTime()` to determine the `runAfter` date for the rescheduled job (unless the error provides its own `retryDate`).

```typescript
const server = new JobQueueServer(MyJob, {
  storage,
  queueName: "my-queue",
  limiter: new CompositeLimiter([
    new ConcurrencyLimiter(3),
    new EvenlySpacedRateLimiter({
      maxExecutions: 30,
      windowSizeInSeconds: 60,
    }),
  ]),
  workerCount: 3,
});
```

### External Rate Limit Signals

When an external API returns a rate limit response (e.g., HTTP 429 with `Retry-After`), your job can throw a `RetryableJobError` with a specific `retryDate`. You can also directly set the limiter's next available time:

```typescript
import { RetryableJobError } from "@workglow/job-queue";

class ApiJob extends Job<ApiInput, ApiOutput> {
  async execute(input: ApiInput, context: IJobExecuteContext): Promise<ApiOutput> {
    const response = await fetch(input.url);
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "60", 10);
      throw new RetryableJobError("Rate limited by API", new Date(Date.now() + retryAfter * 1000));
    }
    return await response.json();
  }
}
```

## Recipes

### Recipe 1: AI Provider Rate Limiting

Limit concurrent requests to an AI provider while respecting their per-minute quota:

```typescript
const anthropicLimiter = new CompositeLimiter([
  new ConcurrencyLimiter(5), // max 5 in-flight requests
  new RateLimiter(rateLimiterStorage, "anthropic", {
    maxExecutions: 50, // 50 requests per minute
    windowSizeInSeconds: 60,
    initialBackoffDelay: 2_000,
    backoffMultiplier: 2,
    maxBackoffDelay: 120_000,
  }),
]);
```

### Recipe 2: Gentle API Crawling

Space out requests evenly with a small additional delay:

```typescript
const crawlLimiter = new CompositeLimiter([
  new EvenlySpacedRateLimiter({
    maxExecutions: 10,
    windowSizeInSeconds: 60,
  }),
  new DelayLimiter(500), // at least 500ms between starts
]);
```

### Recipe 3: Multi-Provider Queues

Use different limiters for different queues, each respecting the provider's specific limits:

```typescript
const openaiServer = new JobQueueServer(OpenAiJob, {
  storage: openaiStorage,
  queueName: "openai",
  limiter: new CompositeLimiter([
    new ConcurrencyLimiter(10),
    new RateLimiter(storage, "openai", {
      maxExecutions: 500,
      windowSizeInSeconds: 60,
    }),
  ]),
  workerCount: 4,
});

const ollamaServer = new JobQueueServer(OllamaJob, {
  storage: ollamaStorage,
  queueName: "ollama",
  limiter: new ConcurrencyLimiter(2), // local GPU, limit concurrency only
  workerCount: 1,
});
```

### Recipe 4: No Rate Limiting

For local compute tasks that do not need throttling:

```typescript
const server = new JobQueueServer(LocalJob, {
  storage,
  queueName: "local-compute",
  // No limiter option = NullLimiter (no restrictions)
  workerCount: 8,
});
```

## Service Tokens

The limiter system uses Workglow's dependency injection to register default instances:

| Token                            | Description                                                          |
| -------------------------------- | -------------------------------------------------------------------- |
| `JOB_LIMITER`                    | Generic limiter token (`"jobqueue.limiter"`)                         |
| `CONCURRENT_JOB_LIMITER`         | Concurrency limiter token (`"jobqueue.limiter.concurrent"`)          |
| `EVENLY_SPACED_JOB_RATE_LIMITER` | Evenly-spaced limiter token (`"jobqueue.limiter.rate.evenlyspaced"`) |
| `NULL_JOB_LIMITER`               | Null limiter token (`"jobqueue.limiter.null"`)                       |

## API Reference

### ILimiter

- `canProceed(): Promise<boolean>` -- Check whether a new job can start now.
- `recordJobStart(): Promise<void>` -- Record that a job has begun executing.
- `recordJobCompletion(): Promise<void>` -- Record that a job has finished.
- `getNextAvailableTime(): Promise<Date>` -- Earliest time a new job could start.
- `setNextAvailableTime(date: Date): Promise<void>` -- Externally impose a delay.
- `clear(): Promise<void>` -- Reset the limiter to its initial state.

### NullLimiter

- `new NullLimiter()` -- No-op limiter. All methods are passthrough.

### ConcurrencyLimiter

- `new ConcurrencyLimiter(maxConcurrentJobs: number)` -- Create a concurrency limiter.

### RateLimiter

- `new RateLimiter(storage: IRateLimiterStorage, queueName: string, options: RateLimiterWithBackoffOptions)` -- Create a sliding-window rate limiter with exponential backoff.

### DelayLimiter

- `new DelayLimiter(delayInMilliseconds?: number)` -- Create a fixed-delay limiter (default: 50ms).

### EvenlySpacedRateLimiter

- `new EvenlySpacedRateLimiter(options: RateLimiterOptions)` -- Create an evenly-spaced rate limiter.

### CompositeLimiter

- `new CompositeLimiter(limiters?: ILimiter[])` -- Create a composite limiter from an array of limiters.
- `addLimiter(limiter: ILimiter): void` -- Add a limiter at runtime.

## Design Considerations

### Why Composition Over Inheritance

The `ILimiter` interface is intentionally flat. Every limiter -- whether it tracks concurrency, sliding windows, or fixed delays -- implements the same six methods. This makes composition trivial: a `CompositeLimiter` just iterates its children. There is no need for adapter classes, strategy patterns, or complex inheritance hierarchies. If you need a new limiting strategy, you implement `ILimiter` and slot it into a `CompositeLimiter` alongside existing limiters.

### Async Interface

All `ILimiter` methods return `Promise`, even for in-memory limiters where the operation is synchronous. This is deliberate: the `RateLimiter` delegates to storage backends that may involve network I/O (PostgreSQL, Supabase), and the interface must accommodate the most general case. In-memory limiters simply resolve their promises immediately.

### Thread Safety and Process Boundaries

The `ConcurrencyLimiter`, `DelayLimiter`, and `EvenlySpacedRateLimiter` maintain in-memory state. They are accurate within a single process but do not coordinate across multiple processes. If you run multiple server processes that share a queue, use the `RateLimiter` with a shared storage backend (PostgreSQL or Supabase) to ensure global rate limiting.

For concurrency limiting across processes, the `IQueueStorage.next(workerId)` method itself provides implicit concurrency control through atomic claims. The `ConcurrencyLimiter` provides additional throttling within a single process to limit resource consumption (e.g., GPU memory, file descriptors).
