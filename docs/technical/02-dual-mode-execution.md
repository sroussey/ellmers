<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Dual-Mode Execution

## Overview

The Workglow task graph engine provides two distinct, **strictly orthogonal** execution paths that serve fundamentally different purposes:

1. **Full Execution (`run`)** -- Runs the task's `execute()` (or `executeStream()`) method, produces cached and immutable results, and transitions the task to `COMPLETED` status. This is the only path that produces committed output.

2. **Preview Execution (`runPreview`)** -- Runs the task's `executePreview()` method for lightweight, sub-millisecond UI previews. Tasks remain in their current status (typically `PENDING`), and the output is treated as temporary and mutable.

There is no overlap and no overlay. `run()` never invokes `executePreview()`. `runPreview()` never invokes `execute()` or `executeStream()`. Cache hits return cached output verbatim — no preview pass runs on top.

This dual-path architecture allows the same task graph to serve both batch processing and interactive UI scenarios. A user editing an input node in a visual builder sees instant preview updates via `runPreview()`, while the final "Run" button triggers `run()` to produce the authoritative, cached output.

---

## Full Execution: run()

### Purpose

Full execution is the authoritative execution path. It:

- Invokes the task's `execute()` (or `executeStream()`) method with full input validation
- Produces deterministic, cacheable results
- Transitions the task to `COMPLETED` status
- Locks the output as immutable
- Supports caching, streaming, abort signals, timeouts, and telemetry

### Task-Level Flow

When you call `task.run(overrides, runConfig)`, execution is delegated to `TaskRunner.run()`:

```
TaskRunner.run(overrides, config)
  |
  v
1. handleStart(config)
   - Set status = PROCESSING
   - Create AbortController
   - Link parent signal if provided
   - Configure output cache
   - Start telemetry span
   - Emit "start" and "status" events
  |
  v
2. setInput(overrides)
   - Merge overrides into runInputData
  |
  v
3. Resolve config schema annotations
   - Resolve format annotations (e.g., "mcp-server" references) in task.config
   - Uses originalConfig as the resolution source for re-runs
  |
  v
4. resolveSchemaInputs()
   - Resolve format annotations in input (e.g., format:"model", format:"storage:tabular")
   - Replace string identifiers with resolved instances from the ServiceRegistry
  |
  v
5. validateInput()
   - Validate runInputData against the compiled JSON Schema (inputSchema)
   - Throw TaskInvalidInputError if validation fails
  |
  v
6. Check abort
   - If the signal is already aborted, throw TaskAbortedError
  |
  v
7. Check cache (if the effective cache policy is cached)
   - Look up cached output by (task.type, input)
   - If found: assign cached result to runOutputData and return. No preview overlay.
  |
  v
8. Execute
   - If streamable: executeStreamingTask(input) -- consume executeStream() async iterable
   - Otherwise: executeTask(input) -- call task.execute(input, context)
   - execute() (or executeStream()) is the only path called by run(). There is no preview overlay.
  |
  v
9. Store in cache (if the effective cache policy is cached and output is new)
  |
  v
10. handleComplete()
    - Set status = COMPLETED
    - Record completedAt timestamp
    - Set progress = 100
    - End telemetry span
    - Emit "complete" and "status" events
  |
  v
Return runOutputData (locked, immutable)
```

### Graph-Level Flow

When a TaskGraph executes via `run()`, the `TaskGraphRunner` orchestrates all tasks:

```
TaskGraph.run(input, config)
  |
  v
TaskGraphRunner.runGraph(input, config)
  |
  v
For each task in topological order:
  |
  v
  1. copyInputFromEdgesToNode(task)
     - For each incoming dataflow, read the dataflow's value
     - Write it into task.runInputData at the target port
  |
  v
  2. task.run(taskInput, runConfig)
     - Root tasks (no incoming dataflows) receive the graph-level input
     - Non-root tasks receive an empty override (dataflows provide data)
  |
  v
  3. pushOutputFromNodeToEdges(task, output)
     - For each outgoing dataflow, copy the relevant output port value
     - Set the dataflow's status to COMPLETED
  |
  v
Collect results from ending nodes (tasks with no outgoing dataflows)
Return GraphResultArray<Output>
```

### Error Handling

If any task throws during `execute()`, the TaskRunner catches the error and:

1. Sets `task.status = FAILED`
2. Stores the error on `task.error`
3. Aborts any child subgraphs
4. Emits `"error"` and `"status"` events
5. Re-throws the error to the caller

The `TaskGraphRunner` catches per-task errors and can abort the entire graph depending on the failure mode.

### Timeout Support

Tasks support per-task timeouts via the `timeout` config property:

```typescript
const task = new MyTask({ timeout: 5000 }); // 5 seconds
```

When the timeout elapses, the TaskRunner aborts the task and throws a `TaskTimeoutError`. The graph-level `timeout` option in `TaskGraphRunConfig` applies to the entire graph execution.

---

## Runtime guard for preview-only tasks

`TaskRunner.run()` checks at the start of execution whether the task has overridden `executePreview()` but not `execute()`. If so, it throws a `TaskConfigurationError`:

```typescript
const proto = Object.getPrototypeOf(this.task);
if (
  proto.execute === Task.prototype.execute &&
  proto.executePreview !== Task.prototype.executePreview
) {
  throw new TaskConfigurationError(
    `Task "${this.task.type}" implements only executePreview() and cannot be run via run(). ` +
      `After the run/runPreview split, run() requires execute() (or executeStream()). ` +
      `See docs/technical/02-dual-mode-execution.md.`
  );
}
```

The check fires on `run()`, not on construction. `runPreview()` does not trigger the guard — preview-only tasks are valid for preview-only callers.

If you hit this error, add an `execute()` method that produces the committed output. The shared-helper pattern below shows the canonical structure.

---

## Preview Execution: runPreview()

### Purpose

Preview execution exists for **UI previews and interactive feedback**. When a user edits a task's input in a visual builder, the system calls `runPreview()` to propagate lightweight updates through the graph without running heavy computation.

Key characteristics:

- Calls `executePreview()` instead of `execute()`
- Does **not** change the task's status (PENDING stays PENDING)
- Output is temporary and mutable (not cached)
- Only affects `PENDING` tasks; `COMPLETED` tasks return cached output unchanged
- Must complete in under 1 millisecond per task

### Task-Level Flow

```
TaskRunner.runPreview(overrides)
  |
  v
1. Guard: if status == PROCESSING, return existing output (no re-entry)
  |
  v
2. setInput(overrides)
   - Merge overrides into runInputData
  |
  v
3. Resolve config and input schema annotations
   - Same resolution as full run (models, repositories, etc.)
  |
  v
4. handleStartPreview()
   - Mark previewRunning = true (internal flag, no status change)
  |
  v
5. validateInput()
   - Validate against input schema
  |
  v
6. executeTaskPreview(input)
   - Call task.executePreview(input, context)
   - If the result is non-undefined, replace runOutputData entirely (no merge)
   - If the result is undefined, leave runOutputData unchanged
  |
  v
7. handleCompletePreview()
   - Mark previewRunning = false
  |
  v
Return runOutputData (temporary, mutable)
```

### Graph-Level Preview Flow

The graph-level preview execution has critical differences from the full run:

```
TaskGraph.runPreview(input, config)
  |
  v
TaskGraphRunner.runGraphPreview(input, config)
  |
  v
For each task in topological order:
  |
  v
  IF task.status == PENDING:
    1. task.resetInputData()             -- Reset to construction defaults
    2. copyInputFromEdgesToNode(task)     -- Pull from incoming dataflows
  ELSE (COMPLETED):
    Skip input modification              -- Output is locked, do not touch
  |
  v
  IF isRootTask (no incoming dataflows):
    taskInput = input                    -- Pass graph input to root tasks
  ELSE:
    taskInput = {}
  |
  v
  task.runPreview(taskInput)
  |
  v
  pushOutputFromNodeToEdges()            -- Push output to dataflows
  |
  v
Return results from ending nodes
```

### The Less-Than-1ms Constraint

The `executePreview()` method must be extremely fast. Its contract:

- **Target**: Complete in under 1 millisecond
- **Allowed**: Simple transformations, string formatting, preview generation
- **Forbidden**: Network requests, file I/O, heavy computation, model inference

```typescript
// CORRECT: Quick preview computation
async executePreview(input, context) {
  return { preview: input.text.substring(0, 200) };
}

// INCORRECT: Heavy computation in preview path
async executePreview(input, context) {
  // This takes 30 seconds and violates the contract
  const result = await this.trainNeuralNetwork(input);
  return { result };
}
```

The default implementation returns `undefined`, leaving the existing output unchanged:

```typescript
async executePreview(input, context) {
  return undefined;
}
```

Tasks that do not need preview updates can leave this default in place.

### Return-value semantics

`executePreview()` has explicit, non-merging semantics:

- **Returning `Output`** — replaces `runOutputData` entirely. There is no `Object.assign` merge with the previous output. Any field you want preserved must be present in your returned object.
- **Returning `undefined`** — leaves `runOutputData` unchanged.

Tasks that need to read the prior output can read `this.runOutputData` directly inside `executePreview()`.

---

## The Immutability Invariant

The most important invariant in the dual-path system is: **COMPLETED tasks are immutable**.

Once `run()` finishes and a task transitions to `COMPLETED`:

1. `runOutputData` is locked and cached
2. `runInputData` must not be modified
3. `runPreview()` returns the cached output without calling `executePreview()`
4. Dataflows from COMPLETED tasks carry fixed values

This invariant enables several guarantees:

- **Cache correctness**: The mapping from `(type, input)` to `output` is stable.
- **Determinism**: Re-running preview execution on a partially-completed graph produces consistent results.
- **UI consistency**: COMPLETED nodes in a visual builder show their final, authoritative output regardless of how many preview passes occur.

### Mixed COMPLETED/PENDING States

In interactive scenarios, a graph often contains a mix of COMPLETED and PENDING tasks. Consider a three-task pipeline:

```
[TaskA: COMPLETED] --> [TaskB: COMPLETED] --> [TaskC: PENDING]
```

If the user edits TaskC's input and triggers `runPreview()`:

- **TaskA** (COMPLETED): Input is not modified. Returns cached output. Dataflow carries the locked value.
- **TaskB** (COMPLETED): Same behavior -- returns cached output unchanged.
- **TaskC** (PENDING): Input is reset to defaults, then dataflow from TaskB populates it. `executePreview()` runs with the new data.

If the user edits TaskA's defaults and wants to re-run the entire pipeline, the graph must first be reset (`resetGraph()`) to return all tasks to PENDING.

---

## Caching Integration

### How Caching Works

The output cache is selected from the `CacheRegistry` according to the task's effective `CachePolicy`, then maps `(taskType, input)` to `output`. During `run()`:

```typescript
const policy = task.getCachePolicy(inputs);
const outputCache = repoFor(cacheRegistry, policy);
const keyInputs = await buildCacheKey(inputs, outputCache);

if (outputCache) {
  const cached = await outputCache.getOutput(task.type, keyInputs);
  if (cached !== undefined) {
    // Cache hit: return cached output verbatim. No preview overlay.
    task.runOutputData = cached;
    return;
  }
}

const result = await task.execute(input, context);
if (outputCache && result !== undefined) {
  await outputCache.saveOutput(task.type, keyInputs, result);
}
```

### Cache Configuration

Caching can be configured at multiple levels:

```typescript
// Task-level: default policy
class MyTask extends Task {
  public static override cachePolicy: CachePolicy = { kind: "deterministic" };
}

// Tasks with side effects opt out
class DebugLogTask extends Task {
  public static override cachePolicy: CachePolicy = { kind: "none" };
}

// Non-deterministic-but-worth-keeping tasks use run-private caching
class ImageGenerationTask extends Task {
  public static override cachePolicy: CachePolicy = { kind: "private" };
}

// Instance-level legacy override: disables caching for this instance
const task = new MyTask({ cacheable: false });

// Runtime-level legacy override: disables caching for this run
await task.run({}, { cacheable: false });

// Graph-level: enable global cache
await graph.run({}, { outputCache: true });

// Graph-level: custom cache backend
await graph.run({}, { outputCache: myPostgresCache });
```

`CachePolicy.kind` controls which repository slot is used:

1. `"deterministic"` uses the shared deterministic cache. This is the default for `Task`.
2. `"private"` uses the run-private cache, namespaced by `runId`, for non-deterministic outputs that should not leak between workflow runs.
3. `"none"` disables cache lookup and writes.

The effective policy is resolved as follows:

1. `getCachePolicy(inputs)` may be overridden for input-dependent decisions.
2. The default `getCachePolicy()` maps legacy `static cacheable = false` to `{ kind: "none" }` when the class has not declared its own `cachePolicy`.
3. `runConfig.cacheable === false` or `config.cacheable === false` also maps to `{ kind: "none" }` as a backwards-compatible disable switch.
4. Otherwise, the class's static `cachePolicy` is used, falling back to `{ kind: "deterministic" }`.

### Cache and Preview Execution

Preview execution never reads from or writes to the cache. It operates purely on temporary in-memory state. Conversely, full-run cache hits return the cached value verbatim — `executePreview()` is never invoked as part of the full-run path.

---

## Performance Guidelines

### For execute() (Full Mode)

- No performance constraint beyond reasonable execution time
- Use `context.updateProgress(progress, message)` to report progress
- Check `context.signal.aborted` periodically for long operations
- Use the `timeout` config property for safety bounds

```typescript
async execute(input, context) {
  for (let i = 0; i < items.length; i++) {
    if (context.signal.aborted) throw new TaskAbortedError();
    await processItem(items[i]);
    await context.updateProgress(Math.round((i / items.length) * 100));
  }
  return { processed: items.length };
}
```

### For executePreview() (Preview Mode)

- **Must complete in under 1 millisecond**
- No async I/O, no network calls, no heavy computation
- Return previews, summaries, or `undefined` to leave the prior output unchanged
- Use synchronous operations only when possible

```typescript
async executePreview(input, context) {
  // Quick string preview: microseconds
  if (input.text) {
    return { preview: `${input.text.length} characters` };
  }
  return undefined;
}
```

### For Graph-Level Operations

- Use `runPreview()` for interactive feedback during editing
- Call `run()` only when the user explicitly requests execution
- Use `graph.subscribeToTaskProgress()` to show a progress bar
- Set `timeout` and `maxTasks` to prevent runaway execution

---

## API Reference

### Task Methods

| Method                               | Mode    | Description                                   |
| ------------------------------------ | ------- | --------------------------------------------- |
| `task.run(overrides?, runConfig?)`   | Full    | Execute and return immutable output           |
| `task.runPreview(overrides?)`        | Preview | Execute preview and return temporary output   |
| `task.execute(input, context)`       | Full    | Override this to implement task logic         |
| `task.executeStream(input, context)` | Full    | Optional override for streamed full execution |
| `task.executePreview(input, ctx)`    | Preview | Override for sub-1ms preview logic            |
| `task.abort()`                       | Both    | Abort the task via its AbortController        |
| `task.disable()`                     | Both    | Set task to DISABLED status                   |
| `task.resetInputData()`              | Both    | Reset runInputData to construction defaults   |
| `task.setInput(partial)`             | Both    | Merge partial input into runInputData         |
| `task.setDefaults(partial)`          | Both    | Update default input values                   |
| `task.validateInput(input)`          | Both    | Validate input against compiled schema        |

### TaskGraph Methods

| Method                              | Mode    | Description                            |
| ----------------------------------- | ------- | -------------------------------------- |
| `graph.run(input?, config?)`        | Full    | Execute all tasks in topological order |
| `graph.runPreview(input?, config?)` | Preview | Preview execution for UI updates       |
| `graph.abort()`                     | Both    | Abort all running tasks                |
| `graph.resetGraph()`                | Both    | Reset all tasks to PENDING             |

### TaskRunner Properties

| Property           | Type                  | Description                              |
| ------------------ | --------------------- | ---------------------------------------- |
| `running`          | `boolean`             | Whether a full run is in progress        |
| `previewRunning`   | `boolean`             | Whether a preview run is in progress     |
| `task`             | `ITask`               | The task being managed                   |
| `inputStreams`     | `Map<string, Stream>` | Input streams for pass-through streaming |
| `shouldAccumulate` | `boolean`             | Whether to accumulate streaming deltas   |

### IExecuteContext

Provided to `execute()`:

```typescript
interface IExecuteContext {
  signal: AbortSignal; // For cancellation
  updateProgress: (progress: number, message?: string) => Promise<void>;
  own: <T>(task: T) => T; // Register child task
  registry: ServiceRegistry; // DI container
  inputStreams?: Map<string, ReadableStream>; // Upstream streams
}
```

### IExecutePreviewContext

Provided to `executePreview()`:

```typescript
interface IExecutePreviewContext {
  own: <T>(task: T) => T; // Register child task
}
```

---

## Common Patterns

### Pattern: Preview parity via a shared helper

For tasks where the preview computes the same data as `execute()`, just faster (or only the cheap subset). Output fields the preview cannot populate should be declared optional in the task's output schema.

```typescript
// shared helper — pure, fast
function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// Note: `analysis` is optional in the schema — preview can't compute it.
class TextAnalysisTask extends Task<{ text: string }, { wordCount: number; analysis?: string }> {
  async execute(input, ctx) {
    return {
      wordCount: countWords(input.text),
      analysis: await callAIModel(input.text, { signal: ctx.signal }),
    };
  }

  async executePreview(input, ctx) {
    return { wordCount: countWords(input.text) };
  }
}
```

### Pattern: Lighter approximation in preview

For tasks where the preview is a genuinely different (lighter) approximation of `execute()`:

```typescript
class ImageBlurTask extends Task<{ image: ImageBitmap; radius: number }, { image: ImageBitmap }> {
  async execute(input, ctx) {
    return { image: await fullQualityBlur(input.image, input.radius) };
  }

  async executePreview(input, ctx) {
    return { image: fastApproximateBlur(input.image, input.radius) };
  }
}
```

### Pattern: Conditional preview behavior

Skip recomputing the preview when the input has not changed by returning `undefined`:

```typescript
class ImageFilterTask extends Task<{ image: Blob; filter: string }, { preview: string }> {
  private lastFilter: string | undefined;

  async executePreview(input) {
    if (input.filter === this.lastFilter) {
      return undefined; // No change — leave the prior output in place
    }
    this.lastFilter = input.filter;
    return { preview: `Preview: ${input.filter} applied` };
  }
}
```

### Pattern: Mixed-State Graph Interaction

Handle a graph where some tasks are complete and others are pending:

```typescript
const graph = new TaskGraph();
// ... add tasks and dataflows ...

// First run completes everything
await graph.run({ text: "hello" });
// All tasks are now COMPLETED

// User edits a middle task's input -- need to re-run from that point
// Reset only downstream tasks (or reset entire graph)
graph.resetGraph();

// Now all tasks are PENDING again; run with new input
await graph.run({ text: "hello world" });
```

---

## Summary: run() vs runPreview()

| Aspect                 | `run()`                                   | `runPreview()`                                          |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------- |
| **Purpose**            | Full, authoritative run                   | UI previews                                             |
| **Method called**      | `execute()` (or `executeStream()`)        | `executePreview()`                                      |
| **Calls preview?**     | Never                                     | n/a                                                     |
| **Calls execute?**     | n/a                                       | Never                                                   |
| **Final status**       | COMPLETED                                 | Unchanged (stays PENDING)                               |
| **Output**             | Locked, immutable                         | Temporary, mutable                                      |
| **Caching**            | Read + Write (cache hit returns verbatim) | Neither                                                 |
| **Dataflow updates**   | Always applied                            | Only for PENDING tasks                                  |
| **Performance target** | No constraint                             | < 1ms per task                                          |
| **Telemetry**          | Spans recorded                            | No telemetry                                            |
| **Abort support**      | Full (signal + timeout)                   | No abort support                                        |
| **Progress events**    | Emitted                                   | Not emitted                                             |
| **Return semantics**   | Output replaces `runOutputData`           | Non-undefined replaces; `undefined` leaves prior output |
