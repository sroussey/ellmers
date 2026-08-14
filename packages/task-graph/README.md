# @workglow/task-graph

A lightweight yet powerful TypeScript library for building and executing DAG (Directed Acyclic Graph) pipelines of tasks. Provides flexible task orchestration, persistent storage, workflow management, and error handling for complex task execution scenarios.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [Tasks](#tasks)
  - [Task Graphs](#task-graphs)
  - [Workflows](#workflows)
  - [Data Flow](#data-flow)
- [Creating Custom Tasks](#creating-custom-tasks)
- [Building Task Graphs](#building-task-graphs)
- [Using Workflows](#using-workflows)
- [Storage and Caching](#storage-and-caching)
- [Error Handling](#error-handling)
- [Advanced Patterns](#advanced-patterns)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Testing](#testing)
- [License](#license)

## Installation

```bash
npm install @workglow/task-graph
# or
bun add @workglow/task-graph
# or
yarn add @workglow/task-graph
```

### Browser debugging

For Chrome DevTools custom formatters (`Workflow`, `TaskGraph`, `Task`, etc.), import `installDevToolsFormatters` from **`@workglow/task-graph`** (browser build only). See [`src/debug/README.md`](./src/debug/README.md).

## Quick Start

Here's a simple example that demonstrates the core concepts:

```typescript
import { Task, TaskGraph, Dataflow, Workflow } from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util";

// 1. Define a custom task
class MultiplyBy2Task extends Task<{ value: number }, { result: number }> {
  static readonly type = "MultiplyBy2Task";
  static readonly category = "Math";
  static readonly title = "Multiply by 2";
  static readonly description = "Multiplies a number by 2";

  static inputSchema() {
    return {
      type: "object",
      properties: {
        value: {
          type: "number",
          description: "Input number",
        },
      },
      required: ["value"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema() {
    return {
      type: "object",
      properties: {
        result: {
          type: "number",
          description: "Multiplied result",
        },
      },
      required: ["result"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { value: number }) {
    return { result: input.value * 2 };
  }
}

// 2. Use the Task

// 2.1 Use it directly
const task = new MultiplyBy2Task({ value: 15 });
const result = await task.run();
console.log(result); // { result: 30 }

// 2.2 Use it with TaskGraph
const graph = new TaskGraph();
graph.addTask(new MultiplyBy2Task({ value: 15 }, { id: "multiply1" }));
graph.addTask(new MultiplyBy2Task({}, { id: "multiply2" }));
graph.addDataflow(new Dataflow("multiply1", "result", "multiply2", "value"));

const results = await graph.run();
console.log(results); // [{ id: "multiply1", data: { result: 60 } }]

// 2.3 With Workflow
const wf = new Workflow();
wf.addTask(new MultiplyBy2Task({ value: 15 }));
wf.addTask(new MultiplyBy2Task()); // auto-connects to previous task
const result = await wf.run();
console.log(result); // { result: 60 }

// 2.3.1 Adding to Workflow
import { CreateWorkflow } from "@workglow/task-graph";
declare module "@workglow/task-graph" {
  interface Workflow {
    multiplyBy2: CreateWorkflow<{ value: number }>;
  }
}
Workflow.prototype.multiplyBy2 = CreateWorkflow(MultiplyBy2Task);

const wf = new Workflow();
wf.multiplyBy2({ value: 15 });
wf.multiplyBy2(); // input is output from previous task
const result = await wf.run();
console.log(result); // { result: 60 }

// 2.3 Create a helper function
export const MultiplyBy2 = (input: { value: number }) => {
  return new MultiplyBy2Task().run(input);
};
const first = await MultiplyBy2({ value: 15 });
const second = await MultiplyBy2({ value: first.result });
console.log(second); // { result: 60 }
```

## Core Concepts

### Tasks

Tasks are the fundamental units of work. Each task:

- Defines input/output schemas using JSON Schema (from `@workglow/util`), TypeBox, or Zod
- Implements `execute()` for main logic; optionally `executePreview()` for fast UI previews
  (called only by `runPreview()`, never as part of `run()`)
- Has a unique type identifier and category
- Can be cached based on inputs
- Emits lifecycle events

### Task Graphs

TaskGraph is the low-level API for building directed acyclic graphs of tasks:

- Manages tasks and their dependencies
- Handles execution order and parallelization
- Provides detailed control over data flow
- Returns results as an array of task outputs

### Data Flow

Data flows between tasks through `Dataflow` objects that specify:

- Source task and output port
- Target task and input port
- Data transformation and validation
- Error propagation
- Edges in the graph

### Workflows

Workflow is the high-level API that provides:

- Builder pattern for easier task composition
- Automatic task connection based on compatible input/output types
- Pipeline operations (`pipe`, `parallel`)
- Simplified result handling
- Event management

## Creating Custom Tasks

### Basic Task Structure

You can define schemas using plain JSON Schema, TypeBox, or Zod. Here are examples of each approach:

#### Using Plain JSON Schema

```typescript
import { Task, IExecuteContext, type CachePolicy } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";

const MyInputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      description: "Text to process",
    },
    multiplier: {
      type: "number",
      description: "Repeat multiplier",
      default: 1,
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

type MyInput = FromSchema<typeof MyInputSchema>;
// Equivalent to:
// type MyInput = {
//   text: string;
//   multiplier?: number;
// };

const MyOutputSchema = {
  type: "object",
  properties: {
    processed: {
      type: "string",
      description: "Processed text",
    },
    length: {
      type: "number",
      description: "Text length",
    },
  },
  required: ["processed", "length"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

type MyOutput = FromSchema<typeof MyOutputSchema>;

class TextProcessorTask extends Task<MyInput, MyOutput> {
  static readonly type = "TextProcessorTask";
  static readonly title = "Text Processor";
  static readonly description = "Processes text";
  static readonly category = "Text Processing";
  static readonly cachePolicy: CachePolicy = { kind: "deterministic" };

  static inputSchema() {
    return MyInputSchema;
  }

  static outputSchema() {
    return MyOutputSchema;
  }

  async execute(input: MyInput, context: IExecuteContext): Promise<MyOutput> {
    const { text, multiplier = 1 } = input;
    const { signal, updateProgress } = context;

    if (signal?.aborted) {
      throw new TaskAbortedError("Task was cancelled");
    }

    await updateProgress(0.5, "Processing text...");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const processed = text.repeat(multiplier);

    return {
      processed,
      length: processed.length,
    };
  }
}
```

#### Using TypeBox

TypeBox schemas are JSON Schema compatible and can be used directly:

```typescript
import { Task, IExecuteContext, type CachePolicy } from "@workglow/task-graph";
import { Type } from "@sinclair/typebox";
import { DataPortSchema, FromSchema } from "@workglow/util";

const MyInputSchema = Type.Object({
  text: Type.String({ description: "Text to process" }),
  multiplier: Type.Optional(Type.Number({ description: "Repeat multiplier", default: 1 })),
}) satisfies DataPortSchema;

type MyInput = FromSchema<typeof MyInputSchema>;

const MyOutputSchema = Type.Object({
  processed: Type.String({ description: "Processed text" }),
  length: Type.Number({ description: "Text length" }),
}) satisfies DataPortSchema;

type MyOutput = FromSchema<typeof MyOutputSchema>;

class TextProcessorTask extends Task<MyInput, MyOutput> {
  static readonly type = "TextProcessorTask";
  static readonly title = "Text Processor";
  static readonly description = "Processes text";
  static readonly category = "Text Processing";
  static readonly cachePolicy: CachePolicy = { kind: "deterministic" };

  static inputSchema() {
    return MyInputSchema;
  }

  static outputSchema() {
    return MyOutputSchema;
  }

  async execute(input: MyInput, context: IExecuteContext): Promise<MyOutput> {
    const { text, multiplier = 1 } = input;
    const { signal, updateProgress } = context;

    if (signal?.aborted) {
      throw new TaskAbortedError("Task was cancelled");
    }

    await updateProgress(0.5, "Processing text...");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const processed = text.repeat(multiplier);

    return {
      processed,
      length: processed.length,
    };
  }

  // Override validation to use TypeBox's native validation -- only if you needed as the default will work in most cases.
  async validateInput(input: Partial<MyInput>): Promise<boolean> {
    // Use TypeBox's Value.Check for validation
    if (!Value.Check(MyInputSchema, input)) {
      const errors = [...Value.Errors(MyInputSchema, input)];
      const errorMessages = errors.map((error) => {
        const path = error.path || "";
        return `${error.message}${path ? ` (${path})` : ""}`;
      });
      throw new TaskInvalidInputError(
        `Input ${JSON.stringify(input)} does not match schema: ${errorMessages.join(", ")}`
      );
    }
    return true;
  }
}
```

#### Using Zod

Zod 4 has built-in JSON Schema support using the `.toJSONSchema()` method:

```typescript
import { Task, IExecuteContext, type CachePolicy } from "@workglow/task-graph";
import { z } from "zod";
import { DataPortSchema } from "@workglow/util";

const MyInputSchemaZod = z.object({
  text: z.string().describe("Text to process"),
  multiplier: z.number().default(1).optional().describe("Repeat multiplier"),
});

const MyInputSchema = MyInputSchemaZod.toJSONSchema() as DataPortSchema;

// Infer TypeScript types using Zod's built-in type inference
type MyInput = z.infer<typeof MyInputSchemaZod>;

const MyOutputSchemaZod = z.object({
  processed: z.string().describe("Processed text"),
  length: z.number().describe("Text length"),
});

const MyOutputSchema = MyOutputSchemaZod.toJSONSchema() as DataPortSchema;

type MyOutput = z.infer<typeof MyOutputSchemaZod>;

class TextProcessorTask extends Task<MyInput, MyOutput> {
  static readonly type = "TextProcessorTask";
  static readonly title = "Text Processor";
  static readonly description = "Processes text";
  static readonly category = "Text Processing";
  static readonly cachePolicy: CachePolicy = { kind: "deterministic" };

  static inputSchema() {
    return MyInputSchema;
  }

  static outputSchema() {
    return MyOutputSchema;
  }

  async execute(input: MyInput, context: IExecuteContext): Promise<MyOutput> {
    const { text, multiplier = 1 } = input;
    const { signal, updateProgress } = context;

    if (signal?.aborted) {
      throw new TaskAbortedError("Task was cancelled");
    }

    await updateProgress(0.5, "Processing text...");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const processed = text.repeat(multiplier);

    return {
      processed,
      length: processed.length,
    };
  }

  // Override validation to use Zod's native validation -- only if you needed as the default will work in most cases.
  async validateInput(input: Partial<MyInput>): Promise<boolean> {
    try {
      // Use Zod's .parse() for validation (throws on error)
      MyInputSchemaZod.parse(input);
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map((err) => {
          const path = err.path.join(".");
          return `${err.message}${path ? ` (${path})` : ""}`;
        });
        throw new TaskInvalidInputError(
          `Input ${JSON.stringify(input)} does not match schema: ${errorMessages.join(", ")}`
        );
      }
      throw error;
    }
  }
}
```

**Note:** When using native validation, you still need to return a JSON Schema from `inputSchema()` and `outputSchema()` for compatibility with the task graph system. The native validation only affects runtime validation, not schema compatibility checking.

### Task with Progress and Error Handling

```typescript
import { DataPortSchema } from "@workglow/util";

class FileProcessorTask extends Task<{ filePath: string }, { content: string }> {
  static readonly type = "FileProcessorTask";

  static inputSchema() {
    return {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Path to file",
        },
      },
      required: ["filePath"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema() {
    return {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "File content",
        },
      },
      required: ["content"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { filePath: string }, { signal, updateProgress }: IExecuteContext) {
    try {
      await updateProgress(0.1, "Starting file read...");

      if (signal?.aborted) {
        throw new TaskAbortedError("File read cancelled");
      }

      // Simulate file reading with progress
      await updateProgress(0.5, "Reading file...");
      const content = await this.readFile(input.filePath);

      await updateProgress(1.0, "File read complete");

      return { content };
    } catch (error) {
      if (error instanceof TaskAbortedError) {
        throw error; // Re-throw abort errors
      }
      throw new TaskError(`Failed to read file: ${error.message}`);
    }
  }

  private async readFile(path: string): Promise<string> {
    // Implementation would go here
    return "file content";
  }
}
```

## Building Task Graphs

### Simple Task Graph

```typescript
import { TaskGraph, Dataflow } from "@workglow/task-graph";

// Create tasks
const task1 = new TextProcessorTask({ text: "Hello" }, { id: "processor1" });
const task2 = new TextProcessorTask({ text: "World" }, { id: "processor2" });
const task3 = new TextProcessorTask({ text: "" }, { id: "combiner" });

// Build graph
const graph = new TaskGraph();
graph.addTasks([task1, task2, task3]);

// Define data flows
graph.addDataflow(new Dataflow("processor1", "processed", "combiner", "text"));
graph.addDataflow(new Dataflow("processor2", "processed", "combiner", "text"));

// Execute
const results = await graph.run();
```

### Task Graph with Dependencies

```typescript
import { DataPortSchema } from "@workglow/util";

class AddTask extends Task<{ a: number; b: number }, { sum: number }> {
  static readonly type = "AddTask";

  static inputSchema() {
    return {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
      required: ["a", "b"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema() {
    return {
      type: "object",
      properties: {
        sum: { type: "number" },
      },
      required: ["sum"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { a: number; b: number }) {
    return { sum: input.a + input.b };
  }
}

// Create a computational pipeline
const doubleTask = new MultiplyBy2Task({ value: 5 }, { id: "double" });
const doubleTask2 = new MultiplyBy2Task({ value: 5 }, { id: "double2" });
const addTask = new AddTask({}, { id: "add" });

const graph = new TaskGraph();
graph.addTasks([doubleTask, doubleTask2, addTask]);

// Connect outputs to inputs
graph.addDataflow(new Dataflow("double", "result", "add", "a"));
graph.addDataflow(new Dataflow("double2", "result", "add", "b"));

const results = await graph.run();
// Results: double=10, double2=10, add=20
```

### Conditional Execution and Error Handling

```typescript
// Task that might fail
class RiskyTask extends Task<{ shouldFail: boolean }, { success: boolean }> {
  static readonly type = "RiskyTask";

  async execute(input: { shouldFail: boolean }) {
    if (input.shouldFail) {
      throw new TaskError("Task failed as requested");
    }
    return { success: true };
  }
}

// Task that handles errors
class ErrorHandlerTask extends Task<{ fallback: string }, { result: string }> {
  static readonly type = "ErrorHandlerTask";

  async execute(input: { fallback: string }) {
    return { result: input.fallback };
  }
}

const graph = new TaskGraph();
const riskyTask = new RiskyTask({ shouldFail: true }, { id: "risky" });
const handlerTask = new ErrorHandlerTask({ fallback: "default" }, { id: "handler" });

graph.addTasks([riskyTask, handlerTask]);

// Connect error output to handler
graph.addDataflow(new Dataflow("risky", "[error]", "handler", "error"));

try {
  const results = await graph.run();
} catch (error) {
  console.log("Graph execution failed:", error.message);
}
```

## Using Workflows

### Basic Workflow

```typescript
import { Workflow } from "@workglow/task-graph";

const workflow = new Workflow();

// Add tasks to workflow
workflow.addTask(new TextProcessorTask({ text: "Hello, World!" }));

// Run workflow
const result = await workflow.run();
console.log(result); // { processed: "Hello, World!", length: 13 }
```

### Pipeline Workflow

```typescript
// Create a processing pipeline
const workflow = new Workflow();

// Method 1: Using workflow.pipe()
workflow.pipe(
  new TextProcessorTask({ text: "Start" }),
  new TextProcessorTask({ multiplier: 2 }),
  new TextProcessorTask({ multiplier: 3 })
);

const result = await workflow.run();

// Method 2: Using the pipe helper
import { pipe } from "@workglow/task-graph";

const pipeline = pipe([
  new TextProcessorTask({ text: "Start" }),
  new TextProcessorTask({ multiplier: 2 }),
  new TextProcessorTask({ multiplier: 3 }),
]);

const result2 = await pipeline.run();
```

### Parallel Workflow

```typescript
import { parallel } from "@workglow/task-graph";

// Method 1: Using workflow.parallel()
const workflow = new Workflow();
workflow.parallel([
  new TextProcessorTask({ text: "Task 1" }),
  new TextProcessorTask({ text: "Task 2" }),
  new TextProcessorTask({ text: "Task 3" }),
]);

const results = await workflow.run();
// Results will be an array of outputs

// Method 2: Using the parallel helper
const parallelWorkflow = parallel([
  new TextProcessorTask({ text: "Task A" }),
  new TextProcessorTask({ text: "Task B" }),
]);

const results2 = await parallelWorkflow.run();
```

### Complex Workflow with Auto-connections

```typescript
// Workflow automatically connects compatible input/output types
const workflow = new Workflow();

// These will auto-connect because output "result" matches input "value"
workflow.addTask(new MultiplyBy2Task({ value: 5 })); // Outputs: { result: number }
workflow.addTask(new MultiplyBy2Task({})); // Inputs: { value: number }
workflow.addTask(new MultiplyBy2Task({})); // Inputs: { value: number }

const result = await workflow.run();
// Result: 5 * 2 * 2 * 2 = 40
```

### Custom Task Creation for Workflows

```typescript
// Register tasks with the workflow system
declare module "@workglow/task-graph" {
  interface Workflow {
    myTextProcessor: CreateWorkflow<MyInput, MyOutput>;
  }
}

Workflow.prototype.myTextProcessor = Workflow.createWorkflow(TextProcessorTask);

// Now you can use it fluently
const workflow = new Workflow();
workflow.myTextProcessor({ text: "Hello" }).myTextProcessor({ multiplier: 3 });

const result = await workflow.run();
```

## Storage and Caching

### Cache Policy

Every task declares how its outputs may be cached through a `CachePolicy`:

```typescript
type CachePolicy =
  | { kind: "deterministic" } // same inputs → same outputs; safe to share across runs
  | { kind: "private" } // non-deterministic but worth caching; scoped to one run
  | { kind: "none" }; // do not cache (side-effecting tasks)
```

The default is `{ kind: "deterministic" }`. Side-effecting tasks (writes to external systems, sends messages) declare `{ kind: "none" }`. Non-deterministic tasks worth caching for the lifetime of a single run (image generation without a seed, model calls without a temperature lock) declare `{ kind: "private" }` — their outputs are namespaced by `runId` and visible only to that run and its restarts.

For tasks whose policy depends on inputs (a seed turns "private" into "deterministic"), override `getCachePolicy(inputs)`:

```typescript
class AiImageOutputTask extends Task<ImageInput, ImageOutput> {
  static readonly type = "AiImageOutputTask";
  // Static default used when the instance method is not overridden.
  static readonly cachePolicy: CachePolicy = { kind: "private" };

  override getCachePolicy(inputs: ImageInput): CachePolicy {
    return inputs.seed !== undefined ? { kind: "deterministic" } : { kind: "private" };
  }
}
```

### CacheRegistry: two slots

The runner picks a repository per task by reading `CACHE_REGISTRY` from the `ServiceRegistry`. The registry has exactly two slots:

```typescript
interface CacheRegistry {
  deterministic?: TaskOutputRepository;
  private?: TaskOutputRepository;
}
```

Both slots are optional. A missing slot is a silent no-op — the task still runs, it just runs uncached. Apps wire the slots they care about:

```typescript
import {
  CACHE_REGISTRY,
  DefaultCacheRegistry,
  RunPrivateTaskOutputPrimaryKeyNames,
  RunPrivateTaskOutputRepository,
  RunPrivateTaskOutputSchema,
  tabularTaskOutputStorage,
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
  TaskOutputTabularRepository,
} from "@workglow/task-graph";
import { ServiceRegistry } from "@workglow/util";
import { Sqlite, SqliteTabularStorage } from "@workglow/sqlite/storage";

await Sqlite.init();

const deterministic = new TaskOutputTabularRepository({
  storage: tabularTaskOutputStorage(
    new SqliteTabularStorage(
      "./cache.sqlite",
      "task_outputs_deterministic",
      TaskOutputSchema,
      TaskOutputPrimaryKeyNames,
      ["createdAt"]
    )
  ),
});

// The private slot must be a RunPrivateTaskOutputRepository: its own table with
// a runId column and a runId-leading primary key, so run-scoped cleanup is an
// indexed delete. (It takes the ITabularStorage directly — no tabular adapter.)
const privateBacking = new RunPrivateTaskOutputRepository({
  storage: new SqliteTabularStorage(
    "./cache.sqlite",
    "task_outputs_private",
    RunPrivateTaskOutputSchema,
    RunPrivateTaskOutputPrimaryKeyNames,
    ["createdAt"]
  ),
});

const registry = new ServiceRegistry();
registry.registerInstance(
  CACHE_REGISTRY,
  new DefaultCacheRegistry({ deterministic, private: privateBacking })
);

// TaskGraph.run takes (input, config) — runId/registry are run config, not input.
await graph.run({}, { registry, runId: "run-" + crypto.randomUUID() });
```

The runner constructs a per-run `RunPrivateCacheRepo` wrapper over the `private` slot, scoping every entry to `runId` (stored as a first-class column in the run-private table, not a key prefix). The wrapper exists only for the duration of the run; the rows it writes survive in the backing store until either explicit cleanup (on successful completion) or the TTL janitor sweeps them (after a crashed run is abandoned).

### Run identity and durable execution

A run is identified by an opaque `runId` string supplied by the caller of `.run()` in the run config (the second argument; the first argument is graph input):

```typescript
await graph.run({}, { runId, registry });
```

- **First start** of a user-triggered run: generate a fresh `runId` (UUID is typical) and persist it alongside the rest of the run metadata.
- **Restart** after a crash: re-dispatch with the **same** `runId`. The new process constructs a fresh in-memory scheduler but the durable `private` repo still holds the outputs of every task that completed before the crash. Cache hits skip that work; the run finishes from where it effectively left off.
- **Concurrent runs** of the same workflow get different `runId`s, so they never see each other's private-tier outputs.

The runner does not generate `runId` for you. That is the caller's job — only the caller knows whether this `.run()` call is a fresh start or a restart.

If the registered `private` slot is present and the graph contains any task whose policy may resolve to `kind: "private"` (statically or via `getCachePolicy(inputs)`), the runner rejects the run synchronously when `runId` is missing. Graphs without a private slot (or without any private-policy task) don't need a `runId`.

#### Cleanup

- On `succeeded`, the runner awaits `privateRepo.clearRun()` before resolving so that a restart with the same `runId` cannot accidentally hit stale entries from the previous attempt. The wrapper already knows its `runId`, so the method takes no arguments. It also knows which rows it wrote, so cleanup deletes exactly those rather than searching the store for them — see [EXECUTION_MODEL.md](./src/EXECUTION_MODEL.md#lifecycle-of-cache-rows).
- On crash (no terminal status reached), nothing happens at the cache layer — the entries stay on disk so the restart can find them. A resumed run's `clearRun()` does not remove the previous attempt's rows (it never wrote them); the `CacheJanitor` below is what reclaims those.
- For abandoned runs (crashed and never restarted), schedule the `CacheJanitor`:

```typescript
import { CacheJanitor } from "@workglow/task-graph";

const janitor = new CacheJanitor({
  privateBacking,
  // Snapshot of currently-live run IDs; the janitor excludes these from the
  // sweep so a long-running in-flight run does not have its cache rows deleted.
  // Pass `() => []` if no run is ever concurrent with the sweep.
  liveRunIds: () => runner.activeRunIds(),
});
// Sweep run-private rows older than 24 hours.
await janitor.sweepStaleRunPrivate(24 * 60 * 60 * 1000);
```

The run-private cache is its own dedicated table, so the janitor sweeps every entry older than the cutoff; the deterministic tier (a separate repository/table) is never touched. Pass the raw `RunPrivateTaskOutputRepository` here — not a per-run `RunPrivateCacheRepo` wrapper, whose `clearOlderThan` is scoped to a single run.

#### Durability warning

At run start the runner checks whether the registered `private` repo reports `isDurable() === true`. If a graph contains a `private`-policy task but the repo is backed by, say, in-memory storage, a one-time warning is logged: restart survival cannot work against a non-durable backend. For production, point the `private` slot at SQLite, Postgres, or another durable store.

### Cache key and `cacheVersion`

The cache key is:

```
sha256(taskType + getCacheVersion() + fingerprint(inputs))
```

`fingerprint(inputs)` normalizes inputs using the existing `PortCodec` so that ports with `format` annotations hash by their stable wire representation.

`Task.version` (a static number, default `1`) feeds `getCacheVersion()`, which walks the prototype chain and combines each ancestor's version. Bump `version` when the task's semantics change (new prompt template, new defaults, fixed-bug-in-implementation) to force misses for all prior keys:

```typescript
class SummarizeTask extends Task<...> {
  static readonly type = "SummarizeTask";
  static readonly version = 3; // bump → all old cache entries become stale
  static readonly cachePolicy: CachePolicy = { kind: "deterministic" };
  // ...
}
```

Override `getCacheVersion()` only if you need a different versioning story (e.g., include the runtime model hash).

### End-to-end example

```typescript
import {
  Task,
  TaskGraph,
  Workflow,
  CACHE_REGISTRY,
  DefaultCacheRegistry,
  tabularTaskOutputStorage,
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
  TaskOutputTabularRepository,
  type CachePolicy,
} from "@workglow/task-graph";
import { ServiceRegistry } from "@workglow/util";
import { InMemoryTabularStorage } from "@workglow/storage";
import { DataPortSchema } from "@workglow/util";

// A task with deterministic cache policy that simulates expensive work
class ExpensiveTask extends Task<{ n: number }, { result: number }> {
  static readonly type = "ExpensiveTask";
  static readonly cachePolicy: CachePolicy = { kind: "deterministic" };

  static inputSchema() {
    return {
      type: "object",
      properties: {
        n: { type: "number" },
      },
      required: ["n"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema() {
    return {
      type: "object",
      properties: {
        result: { type: "number" },
      },
      required: ["result"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { n: number }) {
    // Simulate 500ms of CPU/IO work
    await new Promise((r) => setTimeout(r, 500));
    return { result: input.n * 2 };
  }
}

// Build a CacheRegistry with a deterministic slot. (Private slot omitted here —
// ExpensiveTask is deterministic, so it never needs the private tier.)
const deterministic = new TaskOutputTabularRepository({
  storage: tabularTaskOutputStorage(
    new InMemoryTabularStorage(TaskOutputSchema, TaskOutputPrimaryKeyNames, ["createdAt"])
  ),
});

const registry = new ServiceRegistry();
registry.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ deterministic }));

const graph = new TaskGraph();
graph.addTask(new ExpensiveTask({ n: 42 }, { id: "exp" }));

// TaskGraph.run takes (input, config). registry/runId live in config.
let t = Date.now();
await graph.run({}, { registry, runId: "run-1" });
const firstRunMs = Date.now() - t;

t = Date.now();
await graph.run({}, { registry, runId: "run-2" }); // different run, same inputs → cache hit
const secondRunMs = Date.now() - t;

console.log({ firstRunMs, secondRunMs });
// e.g. { firstRunMs: ~500, secondRunMs: ~1-5 }
```

The deterministic slot is shared across runs — that is the whole point. The private slot is per-run on read and per-run on cleanup, but the underlying storage handle is long-lived (one connection, many runs). Set up the registry once at app startup; bind it to every `.run()` call.

### Task Graph Persistence

```typescript
import {
  TaskGraph,
  TaskGraphPrimaryKeyNames,
  TaskGraphSchema,
  TaskGraphTabularRepository,
} from "@workglow/task-graph";
import { FsFolderTabularStorage } from "@workglow/storage";

// Create repository
const repository = new TaskGraphTabularRepository({
  tabularRepository: new FsFolderTabularStorage(
    "./task-graphs",
    TaskGraphSchema,
    TaskGraphPrimaryKeyNames
  ),
});

// Save task graph
const graph = new TaskGraph();
graph.addTask(new MultiplyBy2Task({ value: 10 }));
await repository.saveTaskGraph("my-graph", graph);

// Load task graph
const loadedGraph = await repository.getTaskGraph("my-graph");
const results = await loadedGraph.run();
```

### Different Storage Options

Wire `TaskOutputTabularRepository` / `TaskGraphTabularRepository` from `@workglow/task-graph` to a `*TabularStorage` from `@workglow/storage`:

```typescript
import {
  tabularTaskOutputStorage,
  TaskGraphPrimaryKeyNames,
  TaskGraphSchema,
  TaskGraphTabularRepository,
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
  TaskOutputTabularRepository,
} from "@workglow/task-graph";
import {
  FsFolderTabularStorage,
  InMemoryTabularStorage,
  IndexedDbTabularStorage,
} from "@workglow/storage";
import { Sqlite, SqliteTabularStorage } from "@workglow/sqlite/storage";

// In-memory (e.g. tests)
const memoryOutput = new TaskOutputTabularRepository({
  storage: tabularTaskOutputStorage(
    new InMemoryTabularStorage(TaskOutputSchema, TaskOutputPrimaryKeyNames, ["createdAt"])
  ),
});
const memoryGraph = new TaskGraphTabularRepository({
  tabularRepository: new InMemoryTabularStorage(TaskGraphSchema, TaskGraphPrimaryKeyNames),
});

// File system
const fsOutput = new TaskOutputTabularRepository({
  storage: tabularTaskOutputStorage(
    new FsFolderTabularStorage("./task-output-cache", TaskOutputSchema, TaskOutputPrimaryKeyNames)
  ),
});
const fsGraph = new TaskGraphTabularRepository({
  tabularRepository: new FsFolderTabularStorage(
    "./task-graphs",
    TaskGraphSchema,
    TaskGraphPrimaryKeyNames
  ),
});

// SQLite (await Sqlite.init() once before using a path or new Sqlite.Database)
await Sqlite.init();
const sqliteOutput = new TaskOutputTabularRepository({
  storage: tabularTaskOutputStorage(
    new SqliteTabularStorage(
      ":memory:",
      "task_outputs",
      TaskOutputSchema,
      TaskOutputPrimaryKeyNames,
      ["createdAt"]
    )
  ),
});
const sqliteGraph = new TaskGraphTabularRepository({
  tabularRepository: new SqliteTabularStorage(
    ":memory:",
    "task_graphs",
    TaskGraphSchema,
    TaskGraphPrimaryKeyNames
  ),
});

// IndexedDB (browser) — the `@workglow/web` example under `examples/web` includes small helpers
const idbOutput = new TaskOutputTabularRepository({
  storage: tabularTaskOutputStorage(
    new IndexedDbTabularStorage("task_outputs", TaskOutputSchema, TaskOutputPrimaryKeyNames, [
      "createdAt",
    ])
  ),
});
const idbGraph = new TaskGraphTabularRepository({
  tabularRepository: new IndexedDbTabularStorage(
    "task_graphs",
    TaskGraphSchema,
    TaskGraphPrimaryKeyNames
  ),
});
```

## Error Handling

### Task-Level Error Handling

```typescript
class RobustTask extends Task<{ input: string }, { output: string }> {
  async execute(input: { input: string }, { signal }: IExecuteContext) {
    try {
      // Check for cancellation
      if (signal?.aborted) {
        throw new TaskAbortedError("Task cancelled");
      }

      // Your logic here
      const result = await this.processInput(input.input);

      return { output: result };
    } catch (error) {
      if (error instanceof TaskAbortedError) {
        throw error; // Re-throw cancellation
      }

      // Convert to TaskError with context
      throw new TaskError(`Processing failed: ${error.message}`);
    }
  }
}
```

### Graph-Level Error Handling

```typescript
try {
  const results = await graph.run();
} catch (error) {
  if (error instanceof TaskAbortedError) {
    console.log("Execution was cancelled");
  } else if (error instanceof TaskFailedError) {
    console.log("A task failed:", error.message);
    console.log("Failed task:", error.taskId);
  } else if (error instanceof TaskError) {
    console.log("Task error:", error.message);
  }
}
```

### Workflow Error Handling with Events

```typescript
const workflow = new Workflow();

workflow.events.on("error", (error) => {
  console.error("Workflow error:", error);
});

workflow.events.on("start", () => {
  console.log("Workflow started");
});

workflow.events.on("complete", () => {
  console.log("Workflow completed");
});

workflow.addTask(new TextProcessorTask({ text: "Hello" }));
await workflow.run();
```

### Aborting Execution

```typescript
const workflow = new Workflow();
workflow.addTask(new LongRunningTask());

// Start execution
const resultPromise = workflow.run();

// Abort after 1 second
setTimeout(() => {
  workflow.abort();
}, 1000);

try {
  await resultPromise;
} catch (error) {
  if (error instanceof TaskAbortedError) {
    console.log("Execution was aborted");
  }
}
```

## Advanced Patterns

### Composite Tasks (Tasks that contain other tasks)

```typescript
class CompositeTask extends GraphAsTask<{ input: string }, { output: string }> {
  static readonly type = "CompositeTask";

  constructor(input: { input: string }, config: any = {}) {
    super(input, config);

    // Build internal graph
    const subTask1 = new TextProcessorTask({ text: input.input });
    const subTask2 = new TextProcessorTask({ multiplier: 2 });

    this.subGraph.addTasks([subTask1, subTask2]);
    this.subGraph.addDataflow(new Dataflow(subTask1.id, "processed", subTask2.id, "text"));
  }
}
```

### Dynamic Task Creation

```typescript
class TaskFactory extends Task<{ count: number }, { results: any[] }> {
  async execute(input: { count: number }, context: IExecuteContext) {
    const results = [];

    for (let i = 0; i < input.count; i++) {
      // Create tasks dynamically
      const dynamicTask = new MultiplyBy2Task({ value: i });

      // Register with execution context
      context.own(dynamicTask);

      const result = await dynamicTask.run();
      results.push(result);
    }

    return { results };
  }
}
```

### Semantic Format

### Semantic Compatibility Utilities for Task Graph Dataflows

In this project, task graphs have connections between tasks called dataflows. These dataflows have different kinds of compatibility checks:

#### **Static Compatibility**

Static rules help decide if an edge should be connected at all. A connection is statically compatible if:

- The source and target are the same exact type
- The source connects to the equivalent of "any" (target accepts anything)
- The source type is acceptable to the target (e.g., a string to something that accepts `oneOf[string[], string]`)

#### **Runtime Compatibility**

Assuming the connection is allowed at design time (passes static check), runtime rules determine if they are compatible during execution.

Currently, there is one runtime compatibility check:

- If both input and output schemas have `format` annotations attached,
  - The format annotation matches the pattern `/\w+(:\w+)?/`; the first part is the "name". If alone, it matches any other with the same "name". If there is a second part, then that narrows the type.
- Format checks apply to all types (strings, arrays, etc.), not just strings.
- A schema with format can connect to a schema with no format (source has format, target doesn't).
- A schema with no format cannot connect to a schema with format (source doesn't have format, target does).

**Example:**  
In the AI package, `format: 'model'` and `format: 'model:EmbeddingTask'` are used on string types.  
An input with property `model` and `format: 'model'` connects to a target with property `model` and `format: 'model:EmbeddingTask'`—this compatibility is called "runtime".  
It first passes the static check as compatible and then notices a difference in format at runtime.

Format is also used on array types, e.g., `format: 'Float64Array'` on arrays containing Float64 numbers.

> **Note:** Only connections that pass the runtime check will pass data at runtime.

## API Reference

### Core Classes

- **`Task<Input, Output, Config>`**: Base class for all tasks
- **`TaskGraph`**: Low-level graph execution engine
- **`Workflow<Input, Output>`**: High-level workflow builder
- **`Dataflow`**: Represents data flow between tasks
- **`TaskRunner`**: Handles individual task execution

### Key Methods

#### Task

- `run(overrides?)`: Execute the task with optional input overrides (calls `execute()` / `executeStream()`)
- `runPreview(overrides?)`: Run the preview-only path (calls `executePreview()` only)
- `abort()`: Cancel execution

`run()` and `runPreview()` are strictly orthogonal: `run()` never invokes `executePreview()`,
and `runPreview()` never invokes `execute()` or `executeStream()`. There is no post-execute
overlay; cache hits during `run()` return the cached value verbatim.

- `setInput(input)`: Set input values
- `validateInput(input)`: Validate input against schema

#### TaskGraph

- `addTask(task)` / `addTasks(tasks)`: Add tasks to graph
- `addDataflow(dataflow)` / `addDataflows(dataflows)`: Add data flows
- `run(input?, config?)`: Execute the graph
- `getTask(id)`: Get task by ID
- `getDataflow(id)`: Get dataflow by ID

#### Workflow

- `addTask(task)`: Add task to workflow
- `pipe(...tasks)`: Create pipeline
- `parallel(tasks, strategy?)`: Create parallel execution
- `run(input?)`: Execute workflow
- `abort()`: Cancel execution
- `reset()`: Reset workflow state

### Storage Interfaces

- **`TaskOutputRepository`**: Interface for task output caching
- **`TaskGraphRepository`**: Interface for task graph persistence

### Error Types

- **`TaskError`**: Base error class
- **`TaskAbortedError`**: Task was cancelled
- **`TaskFailedError`**: Task execution failed
- **`TaskInvalidInputError`**: Invalid input provided

## Examples

### Data Processing Pipeline

```typescript
// Define processing tasks
class LoadDataTask extends Task<{ source: string }, { data: any[] }> {
  static readonly type = "LoadDataTask";

  async execute(input: { source: string }) {
    const data = await this.loadFromSource(input.source);
    return { data };
  }

  private async loadFromSource(source: string): Promise<any[]> {
    // Implementation
    return [];
  }
}

class TransformDataTask extends Task<{ data: any[] }, { transformed: any[] }> {
  static readonly type = "TransformDataTask";

  async execute(input: { data: any[] }) {
    const transformed = input.data.map((item) => ({
      ...item,
      processed: true,
      timestamp: new Date(),
    }));
    return { transformed };
  }
}

class SaveDataTask extends Task<{ data: any[] }, { saved: boolean }> {
  static readonly type = "SaveDataTask";

  async execute(input: { data: any[] }) {
    await this.saveToDestination(input.data);
    return { saved: true };
  }

  private async saveToDestination(data: any[]): Promise<void> {
    // Implementation
  }
}

// Build pipeline
const pipeline = pipe([
  new LoadDataTask({ source: "database" }),
  new TransformDataTask(),
  new SaveDataTask(),
]);

const result = await pipeline.run();
```

### Parallel Data Processing

```typescript
// Process multiple data sources in parallel
const workflow = new Workflow();

workflow.parallel([
  new LoadDataTask({ source: "api-1" }),
  new LoadDataTask({ source: "api-2" }),
  new LoadDataTask({ source: "api-3" }),
]);

// Merge results
workflow.addTask(new MergeDataTask());

const result = await workflow.run();
```

### Error Recovery Pipeline

```typescript
class RetryableTask extends Task<{ url: string; retries: number }, { data: any }> {
  async execute(input: { url: string; retries: number }) {
    for (let i = 0; i < input.retries; i++) {
      try {
        const data = await fetch(input.url).then((r) => r.json());
        return { data };
      } catch (error) {
        if (i === input.retries - 1) {
          throw new TaskError(`Failed after ${input.retries} retries: ${error.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, i)));
      }
    }
    throw new TaskError("Unexpected error");
  }
}

const workflow = new Workflow();
workflow.addTask(new RetryableTask({ url: "https://api.example.com", retries: 3 }));

try {
  const result = await workflow.run();
} catch (error) {
  console.log("All retries failed:", error.message);
}
```

## Testing

The package includes comprehensive test utilities:

```bash
# Run all tests
bun test

# Run specific test file
bun test src/test/task-graph/TaskGraph.test.ts

# Run tests with coverage
bun test --coverage
```

### Testing Your Tasks

```typescript
import { describe, test, expect } from "vitest";

describe("MyCustomTask", () => {
  test("should process input correctly", async () => {
    const task = new MyCustomTask({ input: "test" });
    const result = await task.run();

    expect(result.output).toBe("expected-result");
  });

  test("should handle errors gracefully", async () => {
    const task = new MyCustomTask({ input: "invalid" });

    await await expect(task.run()).rejects.toThrow(TaskError);
  });

  test("should respect cancellation", async () => {
    const task = new LongRunningTask();

    const resultPromise = task.run();
    task.abort();

    await expect(resultPromise).rejects.toThrow(TaskAbortedError);
  });
});
```

## License

Apache 2.0 - See [LICENSE](./LICENSE) for details.
