<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Event System

## 1. Overview

The Workglow event system provides type-safe, synchronous event emission and subscription across the
entire framework. At its core is the `EventEmitter<T>` class from `@workglow/util`, a lightweight
publish-subscribe primitive that is generic over an event listener map. Every major subsystem in
Workglow -- storage backends, tasks, dataflows, task graphs, workflows, and the underlying DAG data
structure -- composes or extends `EventEmitter` to expose domain-specific events with full
compile-time type safety.

The design philosophy is straightforward: define a record type that maps event names to listener
function signatures, parameterize `EventEmitter` with that type, and let TypeScript enforce that
every `emit()`, `on()`, `off()`, `once()`, `subscribe()`, and `waitOn()` call matches the declared
contract. There is no runtime event name registry, no string-based dispatch table, and no unchecked
`any` types leaking through the public API.

**Import path:**

```ts
import { EventEmitter } from "@workglow/util";
import type { EventParameters } from "@workglow/util";
```

**Source location:** `packages/util/src/events/EventEmitter.ts`

---

## 2. Type System

The event system is built on a small set of interconnected generic types.

### EventListener

```ts
type EventListener<Events, EventType extends keyof Events> = Events[EventType];
```

Resolves the listener function type for a given event name. When `Events` is
`{ start: () => void; error: (e: Error) => void }` and `EventType` is `"error"`, this yields
`(e: Error) => void`.

### EventListeners

```ts
type EventListeners<Events, EventType extends keyof Events> = Array<{
  listener: EventListener<Events, EventType>;
  once?: boolean;
}>;
```

Internal storage format. Each registered listener is wrapped in an object that tracks whether it
should fire only once.

### EventParameters

```ts
export type EventParameters<Events, EventType extends keyof Events> = {
  [Event in EventType]: EventListener<Events, EventType> extends (...args: infer P) => any
    ? P
    : never;
}[EventType];
```

Extracts the parameter tuple of a listener function. This is the type used for `emit()` arguments
and `waitOn()` return values. For a listener `(progress: number, message?: string) => void`, the
resulting type is `[progress: number, message?: string]`.

### EmittedReturnType

```ts
export type EmittedReturnType<Events, EventType extends keyof Events> = EventParameters<
  Events,
  EventType
>;
```

Alias used as the resolved type of `waitOn()`. Returns the full parameter tuple as an array.

### Defining an event map

Every consumer of the event system defines a record type mapping event names (string literal keys)
to listener function signatures:

```ts
type MyEventListeners = {
  start: () => void;
  progress: (percent: number, message?: string) => void;
  error: (error: Error) => void;
  complete: (result: Record<string, unknown>) => void;
};
```

TypeScript then enforces that:

- `emitter.on("progress", (percent, message) => { ... })` receives the correct parameter types.
- `emitter.emit("progress", 50, "halfway")` requires exactly the declared arguments.
- `emitter.emit("progress", "wrong")` is a compile-time error.
- `emitter.on("typo", () => {})` is a compile-time error -- no such event exists.

---

## 3. Core API

### Constructor

```ts
const emitter = new EventEmitter<MyEventListeners>();
```

Creates a new emitter with an empty listener map. The generic parameter is the event listener
record type.

### on(event, listener): this

Registers a persistent listener for the named event. Returns `this` for chaining.

```ts
emitter.on("progress", (percent, message) => {
  console.log(`${percent}%: ${message}`);
});
```

### off(event, listener): this

Removes a previously registered listener by reference identity. Returns `this` for chaining.
If the listener is not found, this is a no-op.

```ts
const handler = (percent: number) => {
  /* ... */
};
emitter.on("progress", handler);
emitter.off("progress", handler);
```

### once(event, listener): this

Registers a listener that fires exactly once. After the next emission of the event, the listener
is automatically removed. Returns `this` for chaining.

```ts
emitter.once("complete", (result) => {
  console.log("Done:", result);
});
```

### emit(event, ...args): void

Fires an event synchronously. All registered listeners for the event are called in registration
order. See section 6 for error handling semantics.

```ts
emitter.emit("progress", 75, "three quarters done");
```

### removeAllListeners(event?): this

Removes all listeners for a specific event, or all listeners for all events if no argument is
provided. Returns `this` for chaining.

```ts
emitter.removeAllListeners("progress"); // clear one event
emitter.removeAllListeners(); // clear everything
```

---

## 4. subscribe() -- Unsubscribe Pattern

The `subscribe()` method wraps `on()` and returns a teardown function:

```ts
public subscribe<Event extends keyof EventListenerTypes>(
  event: Event,
  listener: EventListener<EventListenerTypes, Event>
): () => void {
  this.on(event, listener);
  return () => this.off(event, listener);
}
```

This pattern is critical for managing listener lifetimes in complex systems where multiple
subscriptions must be cleaned up together. Workglow uses it extensively in `TaskGraph` to compose
teardown arrays:

```ts
const unsubscribes: (() => void)[] = [];

// Subscribe to status events on all existing tasks
for (const task of graph.getTasks()) {
  const unsub = task.subscribe("status", (status) => {
    callback(task.id, status);
  });
  unsubscribes.push(unsub);
}

// Also subscribe to future tasks being added
const graphUnsub = graph.subscribe("task_added", (taskId) => {
  const task = graph.getTask(taskId);
  if (!task) return;
  const unsub = task.subscribe("status", (status) => {
    callback(task.id, status);
  });
  unsubscribes.push(unsub);
});
unsubscribes.push(graphUnsub);

// Single teardown cleans everything
return () => {
  unsubscribes.forEach((unsub) => unsub());
};
```

This pattern appears in `TaskGraph.subscribeToTaskStatus()`, `subscribeToTaskProgress()`,
`subscribeToDataflowStatus()`, `subscribeToTaskStreaming()`, and
`subscribeToTaskEntitlements()`.

---

## 5. waitOn() -- Promise-Based Event Waiting

The `waitOn()` method converts a one-shot event into a `Promise`, enabling `async`/`await`
coordination:

```ts
public waitOn<Event extends keyof EventListenerTypes>(
  event: Event
): Promise<EmittedReturnType<EventListenerTypes, Event>> {
  return new Promise((resolve) => {
    const listener = ((...args: any[]) => {
      resolve(args as any);
    }) as EventListener<EventListenerTypes, Event>;
    this.once(event, listener);
  });
}
```

The returned promise resolves with an array of all event arguments:

```ts
// Event with arguments
const [progress, message] = await emitter.waitOn("progress");

// Event with no arguments
const [] = await emitter.waitOn("complete"); // resolves to []

// Practical usage: wait for a task to finish
const [status] = await task.waitOn("status");

// Wait for a workflow to complete
await workflow.waitOn("complete");
```

**Key characteristics:**

- Uses `once()` internally, so the listener is automatically removed after resolution.
- The promise resolves with the parameter tuple as an array, even for events with no arguments
  (returns `[]`).
- There is no built-in timeout. Callers should use `Promise.race()` with a timer if a deadline
  is needed.
- If the event is never emitted, the promise never resolves. The garbage collector will
  eventually clean up the listener and promise if no references remain.

---

## 6. Error Handling

The `emit()` method implements careful error handling to ensure all listeners execute even when
some throw:

```ts
public emit<Event extends keyof EventListenerTypes>(
  this: EventEmitter<EventListenerTypes>,
  event: Event,
  ...args: EventParameters<EventListenerTypes, Event>
) {
  const listeners = this.listeners[event];
  if (listeners) {
    // 1. Snapshot the listener array
    const snapshot = [...listeners];
    const errors: unknown[] = [];

    // 2. Call every listener, collecting errors
    for (const { listener } of snapshot) {
      try {
        listener(...args);
      } catch (e) {
        errors.push(e);
      }
    }

    // 3. Remove once listeners after all have been called
    this.listeners[event] = listeners.filter((l) => !l.once);

    // 4. Re-throw the first error
    if (errors.length > 0) {
      throw errors[0];
    }
  }
}
```

**Design decisions:**

| Behavior                         | Rationale                                                                                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Listener snapshot**            | The listener array is shallow-copied before iteration. This prevents issues when a listener adds or removes other listeners during emission (concurrent modification).                                                 |
| **Error collection**             | All listeners run regardless of whether earlier listeners throw. Errors are collected in an array.                                                                                                                     |
| **First-error re-throw**         | After all listeners have executed, the first collected error is re-thrown. Subsequent errors are silently discarded. This ensures the emitter does not swallow exceptions while still guaranteeing all listeners fire. |
| **Once cleanup after iteration** | One-time listeners are removed from the original array (not the snapshot) after the full iteration completes. This ensures `once` listeners are called exactly once even if `emit()` is called reentrantly.            |

---

## 7. Usage in Storage

All storage backends emit events through a composed `EventEmitter` instance. This enables reactive
UI updates, caching layers, telemetry, and cross-storage synchronization without tight coupling.

### Key-Value Storage Events

Defined in `packages/storage/src/kv/IKvStorage.ts`:

```ts
type KvEventListeners<Key, Value, Combined> = {
  put: (key: Key, value: Value) => void;
  get: (key: Key, value: Value | undefined) => void;
  getAll: (results: Combined[] | undefined) => void;
  delete: (key: unknown) => void;
  deleteall: () => void;
};
```

The `KvStorage` base class exposes `on()`, `off()`, `once()`, `emit()`, and `waitOn()` methods
that delegate to an internal `EventEmitter<KvEventListeners<Key, Value, Combined>>`:

```ts
const store = new InMemoryKvStorage<string, MyValue>();

store.on("put", (key, value) => {
  console.log(`Stored ${key}:`, value);
});

store.on("delete", (key) => {
  console.log(`Deleted ${key}`);
});

await store.put("foo", { data: 42 }); // triggers "put" event
await store.delete("foo"); // triggers "delete" event
```

### Tabular Storage Events

Defined in `packages/storage/src/tabular/ITabularStorage.ts`:

```ts
type TabularEventListeners<PrimaryKey, Entity> = {
  put: (entity: Entity) => void;
  get: (key: PrimaryKey, entity: Entity | undefined) => void;
  query: (key: Partial<Entity>, entities: Entity[] | undefined) => void;
  delete: (key: keyof Entity) => void;
  clearall: () => void;
};
```

Every tabular backend (InMemory, SQLite, PostgreSQL, Supabase, IndexedDB, FsFolder) emits these
events after the corresponding operation completes. The `CachedTabularStorage` and
`SharedInMemoryTabularStorage` wrappers forward events from the inner storage.

### Queue Storage Events

Defined in `@workglow/job-queue` at
`packages/job-queue/src/queue-storage/IQueueStorage.ts` and implemented by
`InMemoryQueueStorage` in `packages/job-queue/src/queue-storage/InMemoryQueueStorage.ts`:

```ts
type QueueEventListeners<Input, Output> = {
  change: (payload: QueueChangePayload<Input, Output>) => void;
};
```

Queue storages emit a unified `change` event with a discriminated payload:

```ts
interface QueueChangePayload<Input, Output> {
  type: "INSERT" | "UPDATE" | "DELETE";
  old?: QueueJob<Input, Output>;
  new?: QueueJob<Input, Output>;
}
```

The `InMemoryQueueStorage` uses the `EventEmitter.subscribe()` pattern directly in its
`subscribeToChanges()` method, returning an unsubscribe function:

```ts
return this.events.subscribe("change", filteredCallback);
```

---

## 8. Usage in Tasks

Tasks emit lifecycle and streaming events through a composed `EventEmitter<TaskEventListeners>`.
Defined in `packages/task-graph/src/task/TaskEvents.ts`:

```ts
type TaskEventListeners = {
  start: () => void;
  complete: () => void;
  abort: (error: TaskAbortedError) => void;
  error: (error: TaskError) => void;
  disabled: () => void;
  progress: (progress: number, message?: string, ...args: any[]) => void;
  iteration_start: (index: number, iterationCount: number) => void;
  iteration_complete: (index: number, iterationCount: number) => void;
  iteration_progress: (
    index: number,
    iterationCount: number,
    progress: number,
    message?: string
  ) => void;
  regenerate: () => void;
  reset: () => void;
  status: (status: TaskStatus) => void;
  schemaChange: (inputSchema?: DataPortSchema, outputSchema?: DataPortSchema) => void;
  entitlementChange: (entitlements: TaskEntitlements) => void;
  stream_start: () => void;
  stream_chunk: (event: StreamEvent) => void;
  stream_end: (output: Record<string, unknown>) => void;
};
```

| Event                | Emitted by                       | When                                                     |
| -------------------- | -------------------------------- | -------------------------------------------------------- |
| `start`              | `TaskRunner`                     | Task begins execution                                    |
| `complete`           | `TaskRunner`                     | Task finishes successfully                               |
| `abort`              | `TaskRunner`                     | Task is aborted (carries `TaskAbortedError`)             |
| `error`              | `TaskRunner`                     | Task execution fails (carries `TaskError`)               |
| `disabled`           | `TaskRunner` / `TaskGraphRunner` | Task is skipped due to disabled status                   |
| `progress`           | `Task.execute()` via context     | Task reports progress (0-100)                            |
| `status`             | `TaskRunner`                     | Status transitions (always paired with lifecycle events) |
| `stream_start`       | `TaskRunner`                     | Streaming task begins producing chunks                   |
| `stream_chunk`       | `TaskRunner`                     | Each incremental delta from a streaming task             |
| `stream_end`         | `TaskRunner`                     | Streaming task finishes (carries final output)           |
| `regenerate`         | `IteratorTask`, `Task`           | Task regenerates its internal subgraph                   |
| `reset`              | `TaskGraphRunner`                | Task is reset to `PENDING` state                         |
| `schemaChange`       | `Task.emitSchemaChange()`        | Dynamic input/output schema changes                      |
| `entitlementChange`  | `Task`                           | Required entitlements change                             |
| `iteration_start`    | `IteratorTask`                   | Per-iteration subgraph run begins                        |
| `iteration_complete` | `IteratorTask`                   | Per-iteration subgraph run finishes                      |
| `iteration_progress` | `IteratorTask`                   | Per-iteration progress update                            |

### Dataflow Events

Dataflows (edges connecting task ports) have their own event emitter. Defined in
`packages/task-graph/src/task-graph/DataflowEvents.ts`:

```ts
type DataflowEventListeners = {
  start: () => void;
  streaming: () => void;
  complete: () => void;
  disabled: () => void;
  abort: () => void;
  error: (error: TaskError) => void;
  reset: () => void;
  status: (status: TaskStatus) => void;
};
```

Dataflow status mirrors the source task's lifecycle -- when the source task starts, streams,
completes, or fails, the dataflow emits the corresponding event.

---

## 9. Usage in Graphs

### Low-Level Graph Events

The `Graph` class in `@workglow/util/graph` extends `EventEmitter` to emit structural mutation
events. Defined in `packages/util/src/graph/graph.ts`:

```ts
type GraphEventListeners<NodeId, EdgeId> = {
  "node-added": (node: NodeId) => void;
  "node-removed": (node: NodeId) => void;
  "node-replaced": (node: NodeId) => void;
  "edge-added": (edge: EdgeId) => void;
  "edge-removed": (edge: EdgeId) => void;
  "edge-replaced": (edge: EdgeId) => void;
};
```

These events fire whenever the graph structure changes via `insert()`, `replace()`, `upsert()`,
`addEdge()`, `removeNode()`, or `removeEdge()`.

### TaskGraph Events

`TaskGraph` composes two event sources: its own `EventEmitter<TaskGraphStatusListeners>` for
execution lifecycle events, and the underlying DAG's `GraphEventListeners` for structural events.
The combined type is defined in `packages/task-graph/src/task-graph/TaskGraphEvents.ts`:

```ts
// Execution lifecycle events
type TaskGraphStatusListeners = {
  graph_progress: (progress: number, message?: string, ...args: any[]) => void;
  start: () => void;
  complete: () => void;
  error: (error: Error) => void;
  abort: () => void;
  disabled: () => void;
  task_stream_start: (taskId: TaskIdType) => void;
  task_stream_chunk: (taskId: TaskIdType, event: StreamEvent) => void;
  task_stream_end: (taskId: TaskIdType, output: Record<string, any>) => void;
  entitlementChange: (entitlements: TaskEntitlements) => void;
};

// Structural DAG events (mapped from underlying Graph events)
type GraphEventDagListeners = {
  task_added: (taskId: TaskIdType) => void;
  task_removed: (taskId: TaskIdType) => void;
  task_replaced: (taskId: TaskIdType) => void;
  dataflow_added: (dataflowId: DataflowIdType) => void;
  dataflow_removed: (dataflowId: DataflowIdType) => void;
  dataflow_replaced: (dataflowId: DataflowIdType) => void;
};

// Combined
type TaskGraphListeners = TaskGraphStatusListeners & GraphEventDagListeners;
type TaskGraphEvents = keyof TaskGraphListeners;
```

**Event routing:** The `TaskGraph.on()` and `TaskGraph.off()` methods inspect the event name and
route structural events (`task_added`, `dataflow_removed`, etc.) to the underlying DAG's emitter,
while execution events (`start`, `complete`, etc.) go to the TaskGraph's own emitter. An explicit
mapping table translates between the two naming conventions:

```ts
const EventTaskGraphToDagMapping = {
  task_added: "node-added",
  task_removed: "node-removed",
  task_replaced: "node-replaced",
  dataflow_added: "edge-added",
  dataflow_removed: "edge-removed",
  dataflow_replaced: "edge-replaced",
} as const;
```

### Workflow Events

`Workflow` wraps `TaskGraph` with a higher-level API and its own event map. Defined in
`packages/task-graph/src/task-graph/Workflow.ts`:

```ts
type WorkflowEventListeners = {
  changed: (id: unknown) => void;
  reset: () => void;
  error: (error: string) => void;
  start: () => void;
  complete: () => void;
  abort: (error: string) => void;
  stream_start: (taskId: TaskIdType) => void;
  stream_chunk: (taskId: TaskIdType, event: StreamEvent) => void;
  stream_end: (taskId: TaskIdType, output: Record<string, any>) => void;
  entitlementChange: (entitlements: TaskEntitlements) => void;
};
```

The `Workflow` bridges graph-runner events to its own emitter during `run()`:

```ts
this.events.emit("start");
// ... configure runner callbacks ...
onStreamStart: (taskId) => this.events.emit("stream_start", taskId),
onStreamChunk: (taskId, event) => this.events.emit("stream_chunk", taskId, event),
onStreamEnd: (taskId, output) => this.events.emit("stream_end", taskId, output),
// ... on success ...
this.events.emit("complete");
// ... on failure ...
this.events.emit("error", String(error));
```

### Composite Subscription Helpers

`TaskGraph` provides higher-level subscription methods that compose individual task and dataflow
subscriptions into aggregate observers:

| Method                                  | Listens to                                            | Returns      |
| --------------------------------------- | ----------------------------------------------------- | ------------ |
| `subscribeToTaskStatus(callback)`       | `status` on all tasks + `task_added`                  | `() => void` |
| `subscribeToTaskProgress(callback)`     | `progress` on all tasks + `task_added`                | `() => void` |
| `subscribeToDataflowStatus(callback)`   | `status` on all dataflows + `dataflow_added`          | `() => void` |
| `subscribeToTaskStreaming(callbacks)`   | `task_stream_start/chunk/end` on graph                | `() => void` |
| `subscribeToTaskEntitlements(callback)` | `entitlementChange` on all tasks + structural changes | `() => void` |

Each method automatically subscribes to future tasks/dataflows via `task_added`/`dataflow_added`
events, and the returned function tears down all subscriptions at once.

---

## 10. API Reference

### EventEmitter\<T\>

```ts
class EventEmitter<EventListenerTypes extends Record<string, (...args: any) => any>>
```

**Type Parameters:**

| Parameter            | Constraint                              | Description                                        |
| -------------------- | --------------------------------------- | -------------------------------------------------- |
| `EventListenerTypes` | `Record<string, (...args: any) => any>` | Map of event names to listener function signatures |

**Methods:**

| Method               | Signature                                                                 | Returns              | Description                                       |
| -------------------- | ------------------------------------------------------------------------- | -------------------- | ------------------------------------------------- |
| `on`                 | `on<E extends keyof T>(event: E, listener: T[E]): this`                   | `this`               | Register a persistent listener                    |
| `off`                | `off<E extends keyof T>(event: E, listener: T[E]): this`                  | `this`               | Remove a listener by reference                    |
| `once`               | `once<E extends keyof T>(event: E, listener: T[E]): this`                 | `this`               | Register a one-time listener                      |
| `emit`               | `emit<E extends keyof T>(event: E, ...args: EventParameters<T, E>): void` | `void`               | Fire an event synchronously                       |
| `subscribe`          | `subscribe<E extends keyof T>(event: E, listener: T[E]): () => void`      | `() => void`         | Register a listener; returns unsubscribe function |
| `waitOn`             | `waitOn<E extends keyof T>(event: E): Promise<EmittedReturnType<T, E>>`   | `Promise<[...args]>` | Returns a promise resolved on next emission       |
| `removeAllListeners` | `removeAllListeners(event?: E): this`                                     | `this`               | Remove all listeners for one or all events        |

### Exported Type Utilities

| Type                                   | Description                                           |
| -------------------------------------- | ----------------------------------------------------- |
| `EventParameters<Events, EventType>`   | Extracts the parameter tuple of a listener function   |
| `EmittedReturnType<Events, EventType>` | Alias of `EventParameters`; return type of `waitOn()` |

### Domain-Specific Event Types

| Type                                        | Package                | Events                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KvEventListeners<Key, Value, Combined>`    | `@workglow/storage`    | `put`, `get`, `getAll`, `delete`, `deleteall`                                                                                                                                                                                                                   |
| `TabularEventListeners<PrimaryKey, Entity>` | `@workglow/storage`    | `put`, `get`, `query`, `delete`, `clearall`                                                                                                                                                                                                                     |
| `QueueEventListeners<Input, Output>`        | `@workglow/storage`    | `change`                                                                                                                                                                                                                                                        |
| `GraphEventListeners<NodeId, EdgeId>`       | `@workglow/util/graph` | `node-added`, `node-removed`, `node-replaced`, `edge-added`, `edge-removed`, `edge-replaced`                                                                                                                                                                    |
| `TaskEventListeners`                        | `@workglow/task-graph` | `start`, `complete`, `abort`, `error`, `disabled`, `progress`, `iteration_start`, `iteration_complete`, `iteration_progress`, `regenerate`, `reset`, `status`, `schemaChange`, `entitlementChange`, `stream_start`, `stream_chunk`, `stream_end`                |
| `DataflowEventListeners`                    | `@workglow/task-graph` | `start`, `streaming`, `complete`, `disabled`, `abort`, `error`, `reset`, `status`                                                                                                                                                                               |
| `TaskGraphListeners`                        | `@workglow/task-graph` | `graph_progress`, `start`, `complete`, `error`, `abort`, `disabled`, `task_stream_start`, `task_stream_chunk`, `task_stream_end`, `entitlementChange`, `task_added`, `task_removed`, `task_replaced`, `dataflow_added`, `dataflow_removed`, `dataflow_replaced` |
| `WorkflowEventListeners`                    | `@workglow/task-graph` | `changed`, `reset`, `error`, `start`, `complete`, `abort`, `stream_start`, `stream_chunk`, `stream_end`, `entitlementChange`                                                                                                                                    |
