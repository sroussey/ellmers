<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Worker System

## Overview

The Workglow worker system provides a cross-platform abstraction for offloading
compute-intensive operations -- primarily AI model inference -- to Web Workers
(browser) or worker threads (Node.js, Bun). It is built around two complementary
classes: **WorkerManager** on the main thread and **WorkerServer** inside the
worker. Together they implement a request/response message protocol that supports
three function types: regular (one-shot, used by the `run()` path), streaming
(async generator, also used by `run()`), and preview (lightweight, used only by
the `runPreview()` path).

Key design goals:

- **Lazy initialization.** Workers are not constructed until the first call that
  needs them. A factory function is stored at registration time and invoked on
  demand, with single-flight deduplication to prevent races.
- **Function registries.** Each worker advertises three sets of function names --
  regular, stream, and preview -- in its `ready` message. The manager uses
  these registries to fail fast when a function is not available, avoiding an
  unnecessary roundtrip.
- **Structured cloning with asymmetric transfer.** Data flowing _to_ a worker is
  always cloned (never transferred) so the main thread retains its references.
  Data flowing _back from_ a worker uses transferable objects (zero-copy) for
  TypedArrays, ArrayBuffers, OffscreenCanvas, ImageBitmap, and other
  transferable types.
- **Platform transparency.** The same WorkerManager API works unchanged across
  browsers, Node.js, and Bun. Platform differences are absorbed by thin
  `WorkerServer` subclasses that normalize the message-listener interface.

The worker system is part of the `@workglow/util` package. Main-thread code
imports from `@workglow/util`, while worker-side code imports from
`@workglow/util/worker` -- a lightweight entry point that excludes heavy JSON
Schema validation dependencies.

## WorkerManager

`WorkerManager` lives on the main thread and is the single point of contact for
dispatching work to any registered worker. It is registered as a singleton in the
global `ServiceRegistry` under the `WORKER_MANAGER` service token.

```ts
import { globalServiceRegistry } from "@workglow/util";
import { WORKER_MANAGER, WorkerManager } from "@workglow/util";

const manager = globalServiceRegistry.get<WorkerManager>(WORKER_MANAGER);
```

### Registration

Workers are registered by name with either an eager `Worker` instance or a lazy
factory function:

```ts
// Eager registration -- worker starts immediately
manager.registerWorker("my-worker", new Worker("./my-worker.js"));

// Lazy registration -- worker is constructed on first use
manager.registerWorker("my-worker", () => new Worker("./my-worker.js"));

// Lazy registration with idle eviction after 15 minutes
manager.registerWorker("my-worker", () => new Worker("./my-worker.js"), {
  idleTimeoutMs: 15 * 60 * 1000,
});
```

Registering the same name twice throws an error. Lazy registration is the
recommended approach for AI provider workers because many providers may be
registered at startup but only a subset will be used in a given session.

Only factory-backed registrations can be recreated after termination, so idle
eviction applies only to the lazy `() => Worker` path. Passing
`{ idleTimeoutMs: 0 }` disables idle termination.

### Lazy Initialization and Single-Flight

When `callWorkerFunction`, `callWorkerStreamFunction`, or
`callWorkerPreviewFunction` is invoked on a lazily registered worker, the
manager calls `ensureWorkerReady()`. This method:

1. Checks whether the worker instance already exists. If so, it awaits the
   existing ready promise and returns.
2. Checks for a pending lazy-init promise (single-flight). If another caller
   already triggered construction, the current caller awaits the same promise.
3. Otherwise, invokes the factory function, attaches the resulting `Worker`
   instance via `attachWorkerInstance()`, and stores the init promise for
   deduplication.

This guarantees that no matter how many concurrent calls arrive before the worker
is ready, the factory is invoked exactly once.

If startup fails (for example, the worker never sends `ready` before the
10-second timeout), the manager cleans up the partially attached runtime state
but retains the factory. A later call can therefore retry with a fresh worker
instead of getting stuck behind a permanently rejected initialization promise.

### Idle Termination and Recreation

For factory-backed registrations, `WorkerManager` can terminate an idle worker
after a configurable quiet period. The manager keeps the original factory,
tracks in-flight regular/stream/preview calls, and only schedules termination
when the active-call count returns to zero.

When the idle timer fires, the manager:

1. clears the runtime-only state for the attached worker,
2. calls `worker.terminate()` best-effort, and
3. keeps the factory + idle policy so the next call can recreate the worker.

This is especially useful for AI provider workers that load large local runtime
graphs (ONNX, WebGPU, MediaPipe, native bindings) but may sit unused for long
periods.

### Ready Handshake

After a worker instance is attached, the manager listens for a `ready` message
from the worker with a 10-second timeout. The ready message carries three arrays
of function names:

```ts
{
  type: "ready",
  functions: ["TextGenerationTask", "EmbeddingTask"],
  streamFunctions: ["TextGenerationTask"],
  previewFunctions: ["TextGenerationTask"]
}
```

These are stored in three internal `Map<string, Set<string>>` registries:

| Registry                 | Purpose                                   |
| ------------------------ | ----------------------------------------- |
| `workerFunctions`        | Names of regular (one-shot) functions     |
| `workerStreamFunctions`  | Names of async-generator stream functions |
| `workerPreviewFunctions` | Names of lightweight preview functions    |

Subsequent calls to the manager check the appropriate registry and throw (or
return `undefined` for preview calls) immediately if the function name is not
present, without sending a message to the worker.

### Three Function Types

#### Regular Functions

```ts
const result = await manager.callWorkerFunction<Output>(
  "anthropic", // worker name
  "TextGenerationTask", // function name
  [input, model], // arguments array
  {
    signal: abortController.signal,
    onProgress: (pct, msg) => console.log(`${pct}%: ${msg}`),
  }
);
```

The manager generates a `crypto.randomUUID()` request ID, posts a `call` message
to the worker, and returns a `Promise<T>` that resolves on a `complete` message
or rejects on an `error` message with the matching ID. Progress messages are
forwarded to the optional `onProgress` callback.

An `AbortSignal` is supported: when the signal fires, the manager sends an
`abort` message with the request ID to the worker, which triggers the worker-side
`AbortController`.

#### Streaming Functions

```ts
const stream = manager.callWorkerStreamFunction<StreamEvent>(
  "anthropic",
  "TextGenerationTask",
  [input, model],
  { signal }
);
for await (const event of stream) {
  // event is a stream chunk (e.g., { type: "text-delta", text: "Hello" })
}
```

This returns an `AsyncGenerator<T>`. Internally the manager uses a push-queue
pattern: incoming `stream_chunk` messages push items into a queue, and the
async generator pulls them out. A `complete` message ends the iteration; an
`error` message causes the generator to throw.

If the consumer breaks out of the loop early (e.g., `break` or `return`), the
`finally` block automatically sends an `abort` message to the worker so it stops
generating tokens.

The stream function dispatch has a graceful fallback: if the worker has only a
regular function registered (not a stream function), the manager still allows the
call and the worker-side server runs the regular function and wraps the result as
a single `finish` stream event.

#### Preview Functions

```ts
const preview = await manager.callWorkerPreviewFunction<Output>("anthropic", "TextGenerationTask", [
  input,
  model,
]);
// preview is Output | undefined
```

Preview functions are used for `executePreview()` -- lightweight UI previews
that must complete in under 1 millisecond. They receive the current input and
model and return a fast preview or `undefined`. Preview is a separate path that
is invoked only by `runPreview()`; it never participates in `run()`.

Unlike the other two function types, preview calls return `undefined` instead of
throwing when the function is not registered or when an error occurs. This is
intentional: preview execution is always optional, and the caller treats the
result as a best-effort preview.

## Message Protocol

All messages between the main thread and worker use the structured clone
algorithm via `postMessage`. Each message contains an `id` (UUID), a `type`
string, and type-specific fields.

### Main Thread to Worker

| `type`  | Fields                                              | Description              |
| ------- | --------------------------------------------------- | ------------------------ |
| `call`  | `id`, `functionName`, `args`, `stream?`, `preview?` | Invoke a function        |
| `abort` | `id`                                                | Cancel an in-flight call |

### Worker to Main Thread

| `type`         | Fields                                             | Description                                      |
| -------------- | -------------------------------------------------- | ------------------------------------------------ |
| `ready`        | `functions`, `streamFunctions`, `previewFunctions` | Handshake on startup                             |
| `complete`     | `id`, `data`                                       | Final result of a call                           |
| `error`        | `id`, `data`                                       | Error with `{ message, name }`                   |
| `progress`     | `id`, `data`                                       | Progress update `{ progress, message, details }` |
| `stream_chunk` | `id`, `data`                                       | One chunk from a streaming call                  |

## WorkerServer

`WorkerServerBase` is the worker-side counterpart of `WorkerManager`. It
receives messages, dispatches them to registered functions, and posts results
back. Each platform provides a thin `WorkerServer` subclass that hooks into the
platform-specific message listener.

### Function Registration

```ts
import { WorkerServer, WORKER_SERVER, globalServiceRegistry } from "@workglow/util/worker";

const server = globalServiceRegistry.get<WorkerServer>(WORKER_SERVER);

// Regular function: (input, model, postProgress, signal) => Promise<Output>
server.registerFunction("TextGenerationTask", async (input, model, postProgress, signal) => {
  postProgress(0.1, "Starting inference...");
  const result = await runInference(input, model, signal);
  postProgress(1.0, "Done");
  return result;
});

// Stream function: (input, model, signal) => AsyncIterable<StreamEvent>
server.registerStreamFunction("TextGenerationTask", async function* (input, model, signal) {
  for await (const chunk of streamInference(input, model, signal)) {
    yield { type: "text-delta", text: chunk.text };
  }
  yield { type: "finish", data: {} };
});

// Preview function: (input, model) => Promise<Output | undefined>
server.registerPreviewFunction("TextGenerationTask", async (input, model) => {
  return { text: `Preview for model ${model.model_name}...` };
});

// Signal readiness to the main thread
server.sendReady();
```

The `sendReady()` call must come after all functions are registered. It posts the
`ready` message containing the names of all registered functions, which the
manager uses to populate its registries.

### Abort Handling

Each regular and stream call receives an `AbortController` managed by the server.
When an `abort` message arrives from the main thread, the server calls
`controller.abort()` on the matching request ID and posts an error response. The
registered function receives the `AbortSignal` as its last argument and should
check `signal.aborted` or listen for the `abort` event to stop work promptly.

### Completed-Request Tracking

The server maintains a `completedRequests` set to guard against duplicate
responses (e.g., an abort arriving after a result has already been sent). Entries
are cleaned up after a 5-second delay. A safety cap of 10,000 entries prevents
unbounded growth for high-throughput workers.

## Structured Cloning and Transferables

### Main Thread to Worker (Clone Only)

Data sent to a worker is always cloned, never transferred. This is a deliberate
design choice documented in the source:

> We intentionally do NOT transfer TypedArrays from the main thread to the
> worker. Transferring detaches the buffers on the main thread, which breaks
> downstream tasks that still need those TypedArrays (e.g., the embedding
> vectors flowing through the task graph).

### Worker to Main Thread (Zero-Copy Transfer)

Results sent back from the worker use the transferable optimization. The
`extractTransferables()` function in `WorkerServerBase` recursively walks the
result object and collects transferable objects:

- `ArrayBuffer` instances (including backing buffers of all TypedArray types)
- `OffscreenCanvas`
- `ImageBitmap`
- `VideoFrame`
- `MessagePort`

These are passed as the second argument to `postMessage()`, enabling zero-copy
transfer. A `WeakSet` prevents infinite recursion on circular references, and
duplicates are removed before the `postMessage` call.

## Platform Implementations

### Browser (`Worker.browser.ts`)

Uses the standard Web Worker API. `WorkerServer` attaches a `message` event
listener on `self` (the worker global scope) and delegates to
`WorkerServerBase.handleMessage()`.

```ts
// Browser worker entry
import { WorkerServer } from "@workglow/util/worker";
// WorkerServer automatically listens on `self`
```

### Node.js (`Worker.node.ts`)

Wraps `worker_threads.Worker` in a `WorkerPolyfill` class that normalizes the
API to match the browser `Worker` interface:

- Constructor converts file paths to `file://` URLs via `pathToFileURL()`
- `addEventListener` / `removeEventListener` are mapped to Node's `on` / `off`

The `WorkerServer` subclass listens on the `parentPort` from `worker_threads`.

### Bun (`Worker.bun.ts`)

Bun natively supports the Web Worker API, so the implementation is identical to
the browser version: `globalThis.Worker` is used directly, and `WorkerServer`
listens on `self`.

All three platform implementations register themselves via a side-effect import
into the `globalServiceRegistry` under the `WORKER_SERVER` service token.

## Worker Isolation Model

Workers run in a separate JavaScript context with their own event loop, global
scope, and -- critically -- their own `globalServiceRegistry`. This isolation has
important implications:

1. **No shared state.** The main thread's credential store, model registry, and
   service registry are not accessible from within a worker. Any state needed by
   the worker must be serialized through the message protocol.

2. **Credential resolution on the main thread.** AI providers resolve
   credentials (API keys) on the main thread in `AiTask.getJobInput()` and pass
   the resolved values through the serialized job input. The `credential_key`
   field in a model's `provider_config` is resolved to an actual API key string
   via the `format: "credential"` input resolver before the input reaches the
   worker.

3. **Lightweight worker entry.** Worker code imports from `@workglow/util/worker`
   instead of the full `@workglow/util` barrel export. This excludes heavy
   dependencies like AJV (JSON Schema validation), URI.js, and nearley (parser),
   keeping the worker bundle small.

4. **Provider run functions execute in workers.** Files named `*_JobRunFns.ts`
   in each vendor provider package (under `providers/*`) contain the actual
   inference logic that runs inside workers. These functions must not import
   main-thread-only modules.

## Provider Integration

AI provider packages integrate with the worker system through a standard pattern:

1. **Registration.** The provider registers a worker factory with the
   `WorkerManager`:

   ```ts
   manager.registerWorker(
     "anthropic",
     () => new Worker(new URL("./anthropic-worker.js", import.meta.url))
   );
   ```

2. **Worker entry.** The worker script creates a `WorkerServer`, registers
   run functions for each supported task type, and calls `sendReady()`:

   ```ts
   import { globalServiceRegistry, WORKER_SERVER } from "@workglow/util/worker";
   import type { WorkerServerBase } from "@workglow/util/worker";

   const server = globalServiceRegistry.get<WorkerServerBase>(WORKER_SERVER);

   server.registerFunction("TextGenerationTask", runTextGeneration);
   server.registerStreamFunction("TextGenerationTask", streamTextGeneration);
   server.registerPreviewFunction("TextGenerationTask", previewTextGeneration);

   server.sendReady();
   ```

3. **Execution strategy.** The `AiProviderRegistry` maps each provider to an
   execution strategy (direct or queued). When a strategy invokes the worker,
   it calls the appropriate `WorkerManager` method based on whether the task
   supports streaming.

4. **Input preparation.** The `AiTask.getJobInput()` method on the main thread
   resolves model configurations, credentials, and structured output schemas
   before passing the fully resolved input to the worker via the message
   protocol.

## API Reference

### WorkerManager

| Method                      | Signature                                                                                                                             | Description                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `registerWorker`            | `(name: string, workerOrFactory: Worker \| (() => Worker)) => void`                                                                   | Register a worker by name. Throws if the name is already registered.        |
| `getWorker`                 | `(name: string) => Worker`                                                                                                            | Get the raw Worker instance. Throws if not found.                           |
| `callWorkerFunction`        | `<T>(workerName: string, functionName: string, args: any[], options?: { signal?: AbortSignal; onProgress?: Function }) => Promise<T>` | Call a regular function on a worker.                                        |
| `callWorkerStreamFunction`  | `<T>(workerName: string, functionName: string, args: any[], options?: { signal?: AbortSignal }) => AsyncGenerator<T>`                 | Call a streaming function. Returns an async generator of stream chunks.     |
| `callWorkerPreviewFunction` | `<T>(workerName: string, functionName: string, args: any[]) => Promise<T \| undefined>`                                               | Call a preview function. Returns `undefined` if not registered or on error. |

### WorkerServerBase

| Method                    | Signature                                                            | Description                                                                                     |
| ------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `registerFunction`        | `(name: string, fn: (...args: any[]) => Promise<any>) => void`       | Register a regular function. `fn` receives `(input, model, postProgress, signal)`.              |
| `registerStreamFunction`  | `(name: string, fn: (...args: any[]) => AsyncIterable<any>) => void` | Register a streaming function. `fn` receives `(input, model, signal)`.                          |
| `registerPreviewFunction` | `(name: string, fn: (input, model) => Promise<any>) => void`         | Register a preview function (called only via `runPreview()`).                                   |
| `sendReady`               | `() => void`                                                         | Send the ready handshake to the main thread. Must be called after all functions are registered. |
| `handleMessage`           | `(event: { type: string; data: any }) => Promise<void>`              | Dispatch an incoming message. Called automatically by platform subclasses.                      |

### Service Tokens

| Token            | Type               | Description                               |
| ---------------- | ------------------ | ----------------------------------------- |
| `WORKER_MANAGER` | `WorkerManager`    | Singleton manager on the main thread.     |
| `WORKER_SERVER`  | `WorkerServerBase` | Platform-specific server inside a worker. |

### Worker Entry Point

Worker-side code should import from `@workglow/util/worker` rather than the main
`@workglow/util` barrel. This entry re-exports:

- DI (`ServiceRegistry`, `globalServiceRegistry`, `createServiceToken`)
- Logging (`getLogger`, `setLogger`)
- Worker infrastructure (`WorkerServerBase`, `WORKER_SERVER`, `WorkerManager`,
  `WORKER_MANAGER`)
- Partial JSON parsing (`parsePartialJson`)
- Type-only re-exports for schemas and TypedArrays
