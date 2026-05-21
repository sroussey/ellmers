<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Task Graph DAG Engine

## Overview

The Workglow Task Graph engine is the foundational execution layer of the framework. It models computation as a **directed acyclic graph (DAG)** where nodes are tasks and edges are dataflows that carry typed data between output ports and input ports. The engine is responsible for resolving execution order via topological sorting, propagating data through the graph along dataflow edges, and managing the lifecycle of every task from `PENDING` through `COMPLETED` or `FAILED`.

The engine lives in the `@workglow/task-graph` package and provides two primary abstractions:

- **TaskGraph** -- a low-level DAG container with explicit `addTask`, `addDataflow`, and `run` methods.
- **Workflow** -- a high-level builder that chains tasks with `pipe()`, `parallel()`, and control-flow helpers, then compiles down to a TaskGraph for execution.

Both abstractions share the same runtime: `TaskGraphRunner` executes the graph, `TaskRunner` executes individual tasks, and `Dataflow` objects shuttle data between them.

---

## Core Concepts

### Task

A **Task** is the atomic unit of computation. Every task is an instance of a class that extends the base `Task<Input, Output, Config>` class. Tasks declare their shape through static properties and JSON Schema definitions, and provide execution logic via the `execute()` method.

Key characteristics of a task:

- **Statically typed ports**: Input and output ports are defined by `inputSchema()` and `outputSchema()` static methods that return JSON Schema (`DataPortSchema`) objects.
- **Lifecycle-managed**: Each task transitions through well-defined statuses (`PENDING`, `PROCESSING`, `STREAMING`, `COMPLETED`, `FAILED`, `ABORTING`, `DISABLED`).
- **Independently runnable**: A task can be executed standalone via `task.run()` or as part of a graph.
- **Event-driven**: Tasks emit events (`start`, `complete`, `error`, `progress`, `status`, `stream_start`, `stream_chunk`, `stream_end`) that allow external code to observe execution.

### TaskGraph

A **TaskGraph** wraps a `DirectedAcyclicGraph` data structure specialized for tasks and dataflows. It enforces the acyclic invariant at the structural level -- you cannot add an edge that would create a cycle.

The TaskGraph provides:

- Node management (`addTask`, `removeTask`, `getTask`, `getTasks`)
- Edge management (`addDataflow`, `removeDataflow`, `getDataflow`, `getDataflows`)
- Topological ordering (`topologicallySortedNodes`)
- Execution (`run`, `runPreview`)
- Serialization (`toJSON`, `toDependencyJSON`)
- Event subscription (`subscribe`, `subscribeToTaskStatus`, `subscribeToTaskProgress`, `subscribeToDataflowStatus`, `subscribeToTaskStreaming`)

### Dataflow

A **Dataflow** is a directed edge that connects one task's output port to another task's input port. It is identified by four components:

```
sourceTaskId[sourceTaskPortId] ==> targetTaskId[targetTaskPortId]
```

For example, a dataflow from task A's `result` port to task B's `value` port:

```typescript
new Dataflow("taskA", "result", "taskB", "value");
```

Dataflows carry a `value` property that is populated during execution and can also carry streaming data via a `ReadableStream<StreamEvent>`.

### Topological Execution

When a TaskGraph runs, the `TaskGraphRunner` retrieves all tasks in topological order -- an ordering that guarantees every task executes only after all of its upstream dependencies have completed. For each task in order, the runner:

1. Copies output data from incoming dataflows into the task's `runInputData`.
2. Executes the task.
3. Pushes the task's output data onto all outgoing dataflows.

This ensures deterministic, dependency-respecting execution without the caller needing to manually manage ordering.

---

## Task Definition

Every task class must declare several static properties and two static schema methods. Here is the minimal structure:

```typescript
import { Task } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";

interface MyInput {
  text: string;
}
interface MyOutput {
  wordCount: number;
}

class WordCountTask extends Task<MyInput, MyOutput> {
  static readonly type = "WordCountTask";
  static readonly category = "Text";
  static readonly title = "Word Count";
  static readonly description = "Counts words in a string";
  static readonly cachePolicy = { kind: "deterministic" } as const;

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", title: "Input Text" },
      },
      required: ["text"],
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        wordCount: { type: "integer", title: "Word Count" },
      },
    } as const satisfies DataPortSchema;
  }

  async execute(input: MyInput): Promise<MyOutput> {
    const words = input.text.trim().split(/\s+/);
    return { wordCount: words.length };
  }
}
```

### Required Static Properties

| Property      | Type     | Description                                           |
| ------------- | -------- | ----------------------------------------------------- |
| `type`        | `string` | Unique identifier for this task class in the registry |
| `category`    | `string` | Grouping label for UI organization                    |
| `title`       | `string` | Human-readable name                                   |
| `description` | `string` | Brief description of the task's purpose               |
| `cachePolicy` | `object` | Whether and where results can be cached across runs   |

### Optional Static Properties

| Property                     | Type      | Default | Description                                   |
| ---------------------------- | --------- | ------- | --------------------------------------------- |
| `hasDynamicSchemas`          | `boolean` | `false` | Set `true` if schemas change at runtime       |
| `passthroughInputsToOutputs` | `boolean` | `false` | Mirror dynamic input ports to output          |
| `customizable`               | `boolean` | `false` | Allow saving as a preset in the builder       |
| `isGraphOutput`              | `boolean` | `false` | Mark as the definitive output node of a graph |
| `hasDynamicEntitlements`     | `boolean` | `false` | Entitlements depend on runtime state          |

### The execute() Method

The `execute()` method receives the validated input and an `IExecuteContext` object:

```typescript
async execute(input: Input, context: IExecuteContext): Promise<Output | undefined> {
  // context.signal -- AbortSignal for cancellation
  // context.updateProgress -- report progress (0-100)
  // context.own -- register a child task
  // context.registry -- ServiceRegistry for DI lookups
  return { result: computeSomething(input) };
}
```

If the task returns `undefined`, the output is treated as an empty object `{}`.

### The executePreview() Method

Tasks may optionally override `executePreview()` for lightweight, sub-millisecond preview updates:

```typescript
async executePreview(
  input: Input,
  context: IExecutePreviewContext
): Promise<Output | undefined> {
  // Return a quick preview based on input
  return { preview: input.text.substring(0, 100) };
}
```

This method is called only by `runPreview()` and must complete in under 1 millisecond. Heavy computation belongs exclusively in `execute()`.

`run()` and `runPreview()` are strictly orthogonal paths: `run()` invokes `execute()` (or `executeStream()`) and never calls `executePreview()`; `runPreview()` invokes `executePreview()` and never calls `execute()` or `executeStream()`. There is no post-`execute()` overlay, and cache hits during `run()` return the cached value verbatim.

---

## TaskGraph API Reference

### Construction

```typescript
const graph = new TaskGraph();
// Or with an output cache:
const graph = new TaskGraph({ outputCache: myOutputRepository });
```

### Adding Tasks

```typescript
// Single task
graph.addTask(new WordCountTask({ defaults: { text: "hello world" } }));

// Multiple tasks
graph.addTasks([taskA, taskB, taskC]);
```

### Adding Dataflows

```typescript
// Connect taskA's "result" output to taskB's "value" input
graph.addDataflow(new Dataflow(taskA.id, "result", taskB.id, "value"));

// Bulk add
graph.addDataflows([
  new Dataflow(taskA.id, "output", taskB.id, "input"),
  new Dataflow(taskB.id, "output", taskC.id, "input"),
]);
```

### Special Port Identifiers

| Constant              | Value       | Purpose                            |
| --------------------- | ----------- | ---------------------------------- |
| `DATAFLOW_ALL_PORTS`  | `"*"`       | Pass entire output object as input |
| `DATAFLOW_ERROR_PORT` | `"[error]"` | Route error objects between tasks  |

### Querying the Graph

```typescript
graph.getTask(taskId); // Get task by ID
graph.getTasks(); // All tasks
graph.topologicallySortedNodes(); // Tasks in execution order
graph.getDataflow(dataflowId); // Get dataflow by ID
graph.getDataflows(); // All dataflows
graph.getSourceDataflows(taskId); // Incoming dataflows for a task
graph.getTargetDataflows(taskId); // Outgoing dataflows from a task
graph.getSourceTasks(taskId); // Upstream tasks
graph.getTargetTasks(taskId); // Downstream tasks
```

### Running the Graph

```typescript
// Full execution
const results = await graph.run<MyOutput>(
  { text: "hello world" }, // Input for root tasks
  {
    outputCache: true, // Enable caching
    timeout: 30000, // 30 second timeout
    maxTasks: 100, // Safety limit
    parentSignal: controller.signal, // External abort
  }
);

// Preview execution (lightweight UI updates)
const previews = await graph.runPreview<MyOutput>({ text: "hello world" });
```

### Run Configuration

The `TaskGraphRunConfig` interface provides these options:

| Option                  | Type                              | Description                                                 |
| ----------------------- | --------------------------------- | ----------------------------------------------------------- |
| `outputCache`           | `TaskOutputRepository \| boolean` | Cache backend or `true` to use global                       |
| `parentSignal`          | `AbortSignal`                     | Signal to abort the entire graph                            |
| `registry`              | `ServiceRegistry`                 | DI registry for this execution                              |
| `accumulateLeafOutputs` | `boolean`                         | Accumulate streaming output for leaf nodes (default `true`) |
| `timeout`               | `number`                          | Max execution time in milliseconds                          |
| `maxTasks`              | `number`                          | Maximum number of tasks allowed                             |
| `enforceEntitlements`   | `boolean`                         | Check entitlements before execution                         |

### Abort and Reset

```typescript
graph.abort(); // Abort all running tasks
graph.resetGraph(); // Reset all tasks to PENDING
```

---

## Runtime Architecture

`TaskGraphRunner` is a thin facade that owns three internal collaborator classes plus a per-run state object. Each collaborator has one responsibility; the facade orchestrates them.

```
TaskGraphRunner (facade)
  long-lived: graph, outputCache, processScheduler, previewScheduler,
              registry, resourceScope, accumulateLeafOutputs
  per-run anchor: currentCtx?: RunContext

  owns instances of:
    ├── RunScheduler       — run-loop, abort/timeout, disabled cascade, progress
    ├── EdgeMaterializer   — edge read/write, transforms, error routing
    └── StreamPump         — streaming inputs, tee fan-out, accumulation
                              │
                              ▼
                          RunContext  ── per-run, built by handleStart,
                                          discarded by terminal handlers
```

| Class              | Responsibility                                                                                                               | Lifetime                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `TaskGraphRunner`  | Public API, lifecycle handlers, per-task orchestration in `runTask`, `runGraphPreview` body                                  | Whole runner             |
| `RunScheduler`     | For-await run loop, `pushStatusFromNodeToEdges`, disabled cascade, progress aggregation, timeout arm/clear                   | Whole runner             |
| `EdgeMaterializer` | `copyInputFromEdgesToNode`, `pushOutputFromNodeToEdges`, error-port routing, `resetTask`                                     | Whole runner             |
| `StreamPump`       | `prepareStreamingInputs` (tee), `runStreamingTask`, accumulation policy, stream fan-out                                      | Whole runner             |
| `RunContext`       | One run's mutable state — abort controller, in-progress maps, error map, telemetry span, timeout timer, entitlement enforcer | Single `runGraph()` call |

All four collaborator classes are marked `@internal` and re-exported from `@workglow/task-graph` so unit tests can construct them directly.

### `TaskGraphRunConfig` vs `RunContext`

These are easy to confuse — both relate to a single run, but they live on opposite sides of the start of execution.

|                | `TaskGraphRunConfig`                | `RunContext`                               |
| -------------- | ----------------------------------- | ------------------------------------------ |
| **Direction**  | Caller → runner (input)             | Runner-internal (state)                    |
| **Lifetime**   | Provided once before the run starts | Created at run start, destroyed at run end |
| **Mutability** | Caller-built; runner reads it       | Runner-mutated throughout the run          |
| **Visibility** | Public (part of `runGraph` API)     | `@internal` collaborator state             |
| **Purpose**    | Wishes/policy for the run           | Bookkeeping while the run is in flight     |

`handleStart` translates the caller's wishes into runtime state:

```
config.parentSignal     → ctx.abortController (wired listener)
config.timeout          → ctx.graphTimeoutTimer + ctx.pendingGraphTimeoutError on fire
config.enforceEntitlements + registry → ctx.activeEnforcer
(no config equivalent)  → ctx.runId, ctx.inProgressTasks, ctx.failedTaskErrors, ctx.telemetrySpan
```

Long-lived state from `config` (`registry`, `outputCache`, `resourceScope`, `accumulateLeafOutputs`) goes onto the facade — not into `RunContext`. Only state that exists _only while a run is in flight_ belongs in `RunContext`.

**Mnemonic:** `TaskGraphRunConfig` is what the caller asks for; `RunContext` is what the runner is doing right now.

#### `resourceScope` ownership

`resourceScope` is special: the runner sets `this.resourceScope` from
`config.resourceScope` when present, but if the caller did not provide one,
`runGraph` allocates a private `ResourceScope` and `disposeAll()`s it in a
`finally` block when the run terminates (success, error, or abort). Casual
callers get automatic cleanup of heavyweight resources (model unload, AI
session close, browser disconnect) with no ceremony. Caller-passed scopes are
never touched by the runner — expert callers retain full lifecycle control.

The same auto-ownership pattern applies to `TaskRunner.run` for the bare-task
path. Nested runs (`GraphAsTask`, `IteratorTask`, `runTask`, `subGraph.run`)
always forward `this.resourceScope`, which is defined post-`handleStart`, so
child runners observe a "caller-passed" scope and never own it. Disposal
happens exactly once, at the top of the call stack.

---

## Execution Flow

### Graph-Level Execution (run)

```
TaskGraph.run(input, config)
  |
  v
TaskGraphRunner.runGraph(input, config)
  1. handleStart(config)                  -- Build RunContext, arm timeout, start telemetry
  2. runScheduler.runLoop(input, config, ctx, edgeMat)
       For each task from processScheduler.tasks():
         a. streamPump.prepareStreamingInputs(task)        -- Tee streaming inputs
         b. streamPump.awaitStreamInputs(task, registry)   -- Materialize pending streams
         c. edgeMaterializer.copyInputFromEdgesToNode(task) -- Pull edge values
         d. ctx.activeEnforcer?.checkTask(task)            -- Runtime entitlement
         e. Streaming branch: streamPump.runStreamingTask(...)
            Non-streaming:    task.runner.run(...) → edgeMaterializer.pushOutputFromNodeToEdges
         f. runScheduler.pushStatusFromNodeToEdges + processScheduler.onTaskCompleted
  3. Terminal precedence: timeout > task error > abort > complete
  |
  v
Collect results from ending nodes (no outgoing dataflows)
Return GraphResultArray<Output>
```

### Task-Level Execution (run)

```
Task.run(overrides, runConfig)
  |
  v
TaskRunner.run(overrides, config)
  |
  v
1. handleStart()            -- Set status to PROCESSING, create AbortController
2. setInput(overrides)      -- Merge overrides into runInputData
3. resolveSchemaInputs()    -- Resolve format annotations (models, repositories)
4. validateInput()          -- Validate against compiled JSON Schema
5. Check cache              -- If the cache policy allows it, look up cached result
6. executeTask()            -- Call task.execute(input, context)
7. Cache result             -- If the cache policy allows it, store in output cache
8. handleComplete()         -- Set status to COMPLETED, emit events
  |
  v
Return runOutputData (locked, immutable)
```

---

## Task Lifecycle States

```
PENDING --> PROCESSING --> STREAMING --> COMPLETED
                |                          ^
                +---> COMPLETED -----------+
                |
                +---> FAILED
                |
                +---> ABORTING ---> FAILED

PENDING --> DISABLED
```

| Status       | Description                                                         |
| ------------ | ------------------------------------------------------------------- |
| `PENDING`    | Task has not started. Inputs can be modified freely.                |
| `PROCESSING` | Task is currently executing its `execute()` method.                 |
| `STREAMING`  | Task has begun producing streaming output chunks.                   |
| `COMPLETED`  | Execution finished successfully. Output is locked and immutable.    |
| `FAILED`     | Execution threw an error.                                           |
| `ABORTING`   | Abort has been requested; cleanup is in progress.                   |
| `DISABLED`   | Task was disabled (e.g., by a ConditionalTask that deactivated it). |

### Immutability After Completion

Once a task reaches `COMPLETED`, its `runOutputData` is considered immutable. This is a core invariant of the engine. Preview execution (`runPreview`) will not modify a completed task's output -- it returns the locked output unchanged without invoking `executePreview()`.

---

## Workflow Builder

The `Workflow` class provides a fluent API for constructing task graphs without manually creating dataflow edges.

```typescript
import { Workflow } from "@workglow/task-graph";

const workflow = new Workflow()
  .addTask(new FetchUrlTask({ defaults: { url: "https://example.com" } }))
  .pipe(new ExtractTextTask())
  .pipe(new WordCountTask());

const results = await workflow.run();
```

### Builder Methods

| Method                 | Description                                        |
| ---------------------- | -------------------------------------------------- |
| `addTask(task)`        | Add a task to the workflow                         |
| `pipe(...tasks)`       | Chain tasks sequentially with auto-wired dataflows |
| `parallel(tasks)`      | Run tasks in parallel from the current position    |
| `group(config)`        | Start a sub-group (wraps in GraphAsTask)           |
| `endGroup()`           | Close the current group                            |
| `map(config)`          | Start a map loop over array inputs                 |
| `endMap()`             | Close the map loop                                 |
| `reduce(config)`       | Start a reduce loop with accumulator               |
| `endReduce()`          | Close the reduce loop                              |
| `while(config)`        | Start a conditional loop                           |
| `endWhile()`           | Close the while loop                               |
| `run(input?, config?)` | Build the graph and execute                        |
| `runPreview(input?)`   | Build the graph and run preview-only execution     |

---

## Event System

TaskGraph emits events for structural changes and task lifecycle updates:

### Graph Structural Events

| Event              | Parameters   | Description                       |
| ------------------ | ------------ | --------------------------------- |
| `task_added`       | `taskId`     | A task was added to the graph     |
| `task_removed`     | `taskId`     | A task was removed from the graph |
| `dataflow_added`   | `dataflowId` | A dataflow was added              |
| `dataflow_removed` | `dataflowId` | A dataflow was removed            |

### Streaming Events

| Event               | Parameters            | Description                    |
| ------------------- | --------------------- | ------------------------------ |
| `task_stream_start` | `taskId`              | A streaming task began output  |
| `task_stream_chunk` | `taskId, StreamEvent` | A streaming chunk was produced |
| `task_stream_end`   | `taskId, output`      | Streaming completed            |

### Subscription Helpers

```typescript
// Subscribe to all task status changes
const unsub = graph.subscribeToTaskStatus((taskId, status) => {
  console.log(`Task ${taskId}: ${status}`);
});

// Subscribe to progress updates
graph.subscribeToTaskProgress((taskId, progress, message) => {
  console.log(`Task ${taskId}: ${progress}% - ${message}`);
});

// Subscribe to streaming events
graph.subscribeToTaskStreaming({
  onStreamStart: (taskId) => console.log(`Stream started: ${taskId}`),
  onStreamChunk: (taskId, event) => console.log(`Chunk:`, event),
  onStreamEnd: (taskId, output) => console.log(`Stream ended:`, output),
});

// Clean up
unsub();
```

---

## Serialization

TaskGraph supports JSON serialization for persistence and debugging:

```typescript
// Standard JSON with full structure
const json = graph.toJSON();
// { tasks: [...], dataflows: [...] }

// Dependency-oriented JSON (easier to read)
const deps = graph.toDependencyJSON();
// [{ id, type, defaults, dependencies: { portName: { id, output } } }, ...]
```

Both methods accept an optional `TaskGraphJsonOptions` parameter:

```typescript
graph.toJSON({ withBoundaryNodes: true }); // Include input/output boundary nodes
```

---

## Helper: serialGraph

For simple linear pipelines where all tasks share the same port names, the `serialGraph` helper creates a TaskGraph with serial dataflows:

```typescript
import { serialGraph } from "@workglow/task-graph";

const graph = serialGraph(
  [taskA, taskB, taskC],
  "input", // input port name
  "output" // output port name
);
```

This creates dataflows `taskA[input] ==> taskB[output]` and `taskB[input] ==> taskC[output]` automatically.

---

## Complete Example

```typescript
import { Task, TaskGraph, Dataflow, TaskRegistry } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";

// Define tasks
class DoubleTask extends Task<{ value: number }, { result: number }> {
  static readonly type = "DoubleTask";
  static readonly category = "Math";
  static readonly title = "Double";
  static readonly description = "Doubles the input value";
  static readonly cachePolicy = { kind: "deterministic" } as const;

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
      required: ["value"],
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { result: { type: "number" } },
    } as const satisfies DataPortSchema;
  }

  async execute(input: { value: number }) {
    return { result: input.value * 2 };
  }
}

class AddTask extends Task<{ a: number; b: number }, { sum: number }> {
  static readonly type = "AddTask";
  static readonly category = "Math";
  static readonly title = "Add";
  static readonly description = "Adds two numbers";
  static readonly cachePolicy = { kind: "deterministic" } as const;

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
      required: ["a", "b"],
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { sum: { type: "number" } },
    } as const satisfies DataPortSchema;
  }

  async execute(input: { a: number; b: number }) {
    return { sum: input.a + input.b };
  }
}

// Register tasks
TaskRegistry.registerTask(DoubleTask);
TaskRegistry.registerTask(AddTask);

// Build graph: double two values, then add them
const doubleA = new DoubleTask({ id: "doubleA", defaults: { value: 5 } });
const doubleB = new DoubleTask({ id: "doubleB", defaults: { value: 3 } });
const add = new AddTask({ id: "add" });

const graph = new TaskGraph();
graph.addTasks([doubleA, doubleB, add]);
graph.addDataflows([
  new Dataflow("doubleA", "result", "add", "a"),
  new Dataflow("doubleB", "result", "add", "b"),
]);

// Execute
const results = await graph.run();
// results = [{ id: "add", type: "AddTask", data: { sum: 16 } }]
```
