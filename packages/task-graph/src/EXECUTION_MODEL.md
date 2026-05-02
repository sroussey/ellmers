# Task Graph Execution Model

This document explains the internal execution model of the task graph system. It is intended for developers (human or AI) who need to understand or modify the execution logic.

## Table of Contents

- [Overview](#overview)
- [Task Lifecycle](#task-lifecycle)
- [Normal Execution (run)](#normal-execution-run)
- [Preview Execution (runPreview)](#preview-execution-runpreview)
- [Dataflow and Input Propagation](#dataflow-and-input-propagation)
- [GraphAsTask (Subgraphs)](#graphastask-subgraphs)
- [Key Invariants](#key-invariants)
- [Common Pitfalls](#common-pitfalls)

---

## Overview

The task graph system has two **strictly orthogonal** execution paths:

1. **`run()`** — Full execution that produces cached, immutable results by calling `execute()` (or `executeStream()`).
2. **`runPreview()`** — Lightweight execution for UI updates and previews by calling `executePreview()`.

`run()` never invokes `executePreview()`, and `runPreview()` never invokes `execute()` or `executeStream()`. Cache hits return the cached value verbatim.

---

## Task Lifecycle

### Task Statuses

```
PENDING → PROCESSING → COMPLETED
                    ↘ FAILED
                    ↘ ABORTED
```

| Status       | Description                                                         |
| ------------ | ------------------------------------------------------------------- |
| `PENDING`    | Task has not been executed yet. Inputs can be modified.             |
| `PROCESSING` | Task is currently executing.                                        |
| `COMPLETED`  | Task has finished successfully. **Output is locked and immutable.** |
| `FAILED`     | Task execution threw an error.                                      |
| `ABORTED`    | Task was cancelled via `abort()`.                                   |

### Key Properties

Each task maintains:

- `defaults` - Default input values set at construction time
- `runInputData` - The actual input used for execution (defaults + overrides)
- `runOutputData` - The output produced by execution
- `status` - Current lifecycle status

---

## Normal Execution (run)

### Purpose

Full execution that:

- Runs the task's `execute()` (or `executeStream()`) method
- Produces cached, deterministic results
- Transitions task to `COMPLETED` status
- Makes output immutable

### Flow

```
Task.run(overrides)
    ↓
TaskRunner.run(overrides)
    ↓
1. Guard: if task overrides executePreview() but not execute(),
   throw TaskConfigurationError
2. setInput(overrides)           # Merge overrides into runInputData
3. resolveSchemaInputs()         # Resolve model/repository strings to instances
4. validateInput()               # Validate against input schema
5. Check cache                   # If cacheable: cache hit returns verbatim, no preview overlay
6. executeTask()                 # Call task.execute(input, context) only
7. Store in cache                # If cacheable, cache the result
8. handleComplete()              # Set status = COMPLETED
    ↓
Return runOutputData (locked)
```

`executePreview()` is never called as part of `run()`. There is no post-execute overlay, even on cache hits or after `executeStream()` finishes.

### Graph-Level Execution

```
TaskGraph.run(input)
    ↓
TaskGraphRunner.runGraph(input)        # facade: lifecycle + terminal precedence
    ↓
RunScheduler.runLoop(...)              # owns the for-await loop
    ↓
For each task (from processScheduler.tasks()):
    1. StreamPump.prepareStreamingInputs(task)          # Tee streaming inputs
    2. StreamPump.awaitStreamInputs(task, registry)     # Materialize pending streams
    3. EdgeMaterializer.copyInputFromEdgesToNode(task)  # Pull data from incoming dataflows
    4. ctx.activeEnforcer?.checkTask(task)              # Runtime entitlement
    5. Streaming:     StreamPump.runStreamingTask(...)
       Non-streaming: task.runner.run(...) → EdgeMaterializer.pushOutputFromNodeToEdges()
    6. RunScheduler.pushStatusFromNodeToEdges + processScheduler.onTaskCompleted
    ↓
Return results from ending nodes (no outgoing dataflows)
```

`TaskGraphRunner` is a thin facade. The for-await loop lives in `RunScheduler`; per-task choreography lives in the facade's `runTask`; per-run mutable state (abort controller, in-progress maps, timeout timer, telemetry span, entitlement enforcer) lives in a `RunContext` value object built by `handleStart` and discarded by terminal handlers. See `docs/technical/01-task-graph-dag-engine.md` for the full architecture and the `TaskGraphRunConfig` vs `RunContext` distinction.

### Runtime guard

`TaskRunner.run()` checks at the start of execution whether the task overrides `executePreview()` but not `execute()`. If so, it throws `TaskConfigurationError`. The check fires on `run()`, not on construction. `runPreview()` does not trigger the guard.

---

## Preview Execution (runPreview)

### Purpose

Lightweight execution for:

- UI previews and updates
- Fast transformations (e.g., image filters)
- Propagating intermediate results through PENDING tasks

**Important:** Preview execution only affects `PENDING` tasks. `COMPLETED` tasks return their cached output unchanged.

### Use Case Example

```
User edits an InputNode default → Task is PENDING
    ↓
runPreview() is called
    ↓
InputTask (PENDING) receives new value
    ↓
Downstream tasks (PENDING) get preview updates
    ↓
Tasks run their executePreview() for quick previews
    ↓
Eventually run() is called → All tasks become COMPLETED (locked)
```

### Task-Level Flow

```
Task.runPreview(overrides)
    ↓
TaskRunner.runPreview(overrides)
    ↓
1. If status == PROCESSING: return existing output (no re-entry)
2. setInput(overrides)                    # Update runInputData
3. resolveSchemaInputs()                  # Resolve strings to instances
4. handleStartPreview()                   # previewRunning = true
5. validateInput()
6. executeTaskPreview(input)              # Call task.executePreview()
7. If result !== undefined: runOutputData = result   # No merge
   Else: leave runOutputData unchanged
8. handleCompletePreview()                # previewRunning = false
    ↓
Return runOutputData
```

### Graph-Level Flow

```
TaskGraph.runPreview(input)
    ↓
TaskGraphRunner.runGraphPreview(input)
    ↓
For each task (in topological order):
    ↓
    ┌─ If status == PENDING:
    │      resetInputData()              # Reset to defaults
    │      copyInputFromEdgesToNode()    # Pull from incoming dataflows
    └─ Else (COMPLETED):
           Skip input modification       # Output is locked
    ↓
    If isRootTask (no incoming dataflows):
        taskInput = input                # Pass graph input to root tasks
    Else:
        taskInput = {}
    ↓
    task.runPreview(taskInput)
    ↓
    pushOutputFromNodeToEdges()          # Push output to dataflows
    ↓
Return results from ending nodes
```

### The executePreview Method

```typescript
// Default implementation - returns undefined, leaves runOutputData unchanged
async executePreview(input, context): Promise<Output | undefined> {
    return undefined;
}

// Custom implementation for quick transformations
async executePreview(input, context): Promise<Output | undefined> {
    // Lightweight operation (< 1ms)
    return { preview: this.quickTransform(input) };
}
```

Return-value semantics:

- Non-`undefined` `Output` — replaces `runOutputData` entirely. **No merge** with prior output.
- `undefined` — leaves `runOutputData` unchanged.

If a preview needs the prior output, it can read `this.runOutputData` directly.

---

## Dataflow and Input Propagation

### How Data Flows Between Tasks

```
TaskA (source)                    TaskB (target)
    ↓                                 ↓
outputSchema: {                  inputSchema: {
  result: number                   value: number
}                                }
    ↓                                 ↓
Dataflow("taskA", "result", "taskB", "value")
    ↓
TaskA.runOutputData.result → TaskB.runInputData.value
```

### Key Methods

| Method                                    | Purpose                                                          |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `copyInputFromEdgesToNode(task)`          | Pull data from all incoming dataflows into task's `runInputData` |
| `pushOutputFromNodeToEdges(task, output)` | Push task's output to all outgoing dataflows                     |
| `addInputData(task, data)`                | Merge data into task's `runInputData`                            |

### When Input is Copied

| Execution Path | Task Status | Input Copied?             |
| -------------- | ----------- | ------------------------- |
| `run()`        | Any         | Yes (always)              |
| `runPreview()` | PENDING     | Yes                       |
| `runPreview()` | COMPLETED   | **No** (output is locked) |

---

## GraphAsTask (Subgraphs)

### What is GraphAsTask?

A `GraphAsTask` is a task that contains an internal `TaskGraph` (subgraph). This enables:

- Hierarchical workflow composition
- Encapsulation of complex logic
- Reusable workflow components

### Execution Flow

```
GraphAsTask.run(input)
    ↓
GraphAsTaskRunner.executeTask(input)
    ↓
executeTaskChildren(input)
    ↓
subGraph.run(input)      # Execute the entire subgraph
    ↓
mergeExecuteOutputsToRunOutput()  # Combine results from ending nodes
```

### Preview Execution with Subgraphs

```
GraphAsTask.runPreview(input)
    ↓
GraphAsTaskRunner.executeTaskPreview(input)
    ↓
executeTaskChildrenPreview()
    ↓
subGraph.runPreview(this.task.runInputData)  # ← IMPORTANT: Pass parent's input
    ↓
mergeExecuteOutputsToRunOutput()
```

**Critical:** The parent's `runInputData` is passed to `subGraph.runPreview()` so that root tasks in the subgraph (like InputTask) receive the input values.

### Root Task Input Propagation

In `runGraphPreview()`:

```typescript
const isRootTask = this.graph.getSourceDataflows(task.id).length === 0;

// For root tasks, pass the input parameter (from parent GraphAsTask)
const taskInput = isRootTask ? input : {};

const taskResult = await task.runPreview(taskInput);
```

This ensures:

1. Root tasks (no incoming dataflows) receive input from the parent
2. Non-root tasks receive input from their upstream dataflows

---

## Key Invariants

### 0. Cycle Guarantees

- `TaskGraph` is a `DirectedAcyclicGraph`. The underlying `TaskGraphDAG` extends `DirectedAcyclicGraph` from `@workglow/util/graph`.
- `TaskGraph.addDataflow` throws `CycleError` **synchronously** whenever the new edge would close a cycle. Detection runs inside `DirectedAcyclicGraph.addEdge` via `wouldAddingEdgeCreateCycle`, so no graph can ever reach a cyclic state — cycles are rejected at the construction call, not at run time.
- Loop tasks (`WhileTask`, `IteratorTask`, `MapTask`, `ReduceTask`) achieve repetition by re-running an internally-acyclic subgraph once per iteration, never by adding back-edges. Each subgraph is its own `TaskGraph` and inherits the same invariant. `GraphAsTask.validateAcyclic()` re-asserts the invariant when the subgraph is finalized, so any direct `_dag` manipulation is caught before execution.

### 1. COMPLETED Tasks Are Immutable

Once a task's `run()` completes and status becomes `COMPLETED`:

- `runOutputData` is **locked** and **cacheable**
- `runInputData` should not be modified
- `runPreview()` returns the cached output unchanged (does not invoke `executePreview()`)

### 2. Only PENDING Tasks Receive Dataflow Updates in Preview Mode

```typescript
if (task.status === TaskStatus.PENDING) {
  task.resetInputData();
  this.copyInputFromEdgesToNode(task);
}
```

### 3. Root Tasks Receive Parent Input

In subgraphs, root tasks (no incoming dataflows) receive the parent's input:

```typescript
const taskInput = isRootTask ? input : {};
task.runPreview(taskInput);
```

### 4. executePreview is Lightweight

The `executePreview()` method should:

- Complete quickly (< 1ms ideally)
- Not perform heavy computation
- Return UI preview data (or `undefined` to leave the prior output unchanged)

Heavy computation belongs in `execute()`.

### 5. Preview Execution Respects Task Order

Tasks are executed in topological order (via the preview scheduler), ensuring:

- Upstream tasks run before downstream tasks
- Data is available when needed

### 6. run() and runPreview() Are Strictly Separate

`run()` never invokes `executePreview()`. `runPreview()` never invokes `execute()` or `executeStream()`. There is no overlay, no merge, and no second hidden stage. Cache hits during `run()` return the cached value verbatim.

A task that overrides `executePreview()` but not `execute()` throws `TaskConfigurationError` on its first `run()` call. Implement `execute()` to fix this — typically by extracting a shared helper called by both methods.

---

## Common Pitfalls

### 1. Modifying COMPLETED Task Input

**Wrong:**

```typescript
// Trying to update a COMPLETED task's input
task.setInput({ newValue: 42 }); // ❌ Violates immutability
```

**Correct:**
Only modify input for PENDING tasks, or reset the entire graph first.

### 2. Missing Root Task Input Propagation

**Wrong:**

```typescript
protected async executeTaskChildrenPreview() {
    return this.task.subGraph!.runPreview();  // ❌ No input passed
}
```

**Correct:**

```typescript
protected async executeTaskChildrenPreview() {
    return this.task.subGraph!.runPreview(this.task.runInputData);  // ✓
}
```

### 3. Copying Input to COMPLETED Tasks

**Wrong:**

```typescript
// In runGraphPreview
this.copyInputFromEdgesToNode(task); // ❌ Always copies, even for COMPLETED
```

**Correct:**

```typescript
if (task.status === TaskStatus.PENDING) {
  task.resetInputData();
  this.copyInputFromEdgesToNode(task); // ✓ Only for PENDING
}
```

### 4. Heavy Computation in executePreview

**Wrong:**

```typescript
async executePreview(input) {
    // ❌ Takes 30 seconds
    const result = await this.trainNeuralNetwork(input);
    return { result };
}
```

**Correct:**

```typescript
async executePreview(input) {
    // ✓ Quick preview (< 1ms)
    return { preview: this.quickPreview(input) };
}

async execute(input) {
    // Heavy work belongs here
    const result = await this.trainNeuralNetwork(input);
    return { result };
}
```

### 5. Implementing only executePreview()

**Wrong:**

```typescript
class MyTask extends Task {
  // ❌ Only override executePreview
  async executePreview(input) {
    return { result: input.value * 2 };
  }
}
```

`run()` will throw `TaskConfigurationError` because there is no `execute()` to call.

**Correct:** Extract a shared helper and call it from both methods:

```typescript
function double(value: number): number {
  return value * 2;
}

class MyTask extends Task {
  async execute(input) {
    return { result: double(input.value) };
  }

  async executePreview(input) {
    return { result: double(input.value) };
  }
}
```

---

## Summary

| Aspect               | `run()`                            | `runPreview()`     |
| -------------------- | ---------------------------------- | ------------------ |
| **Purpose**          | Full execution                     | UI previews        |
| **Method called**    | `execute()` (or `executeStream()`) | `executePreview()` |
| **Calls preview?**   | Never                              | n/a                |
| **Calls execute?**   | n/a                                | Never              |
| **Final status**     | COMPLETED                          | Unchanged          |
| **Output**           | Locked/cached                      | Temporary          |
| **Dataflow updates** | Always                             | Only PENDING tasks |
| **Performance**      | Can be slow                        | Should be < 1ms    |
| **User edits**       | Before run starts                  | Before run starts  |

### Key Takeaways

1. Users only edit inputs on PENDING tasks
2. Once `run()` completes, the task is COMPLETED and immutable
3. `runPreview()` propagates lightweight updates through PENDING tasks
4. COMPLETED tasks return cached results in preview mode
5. Root tasks in subgraphs receive input from the parent GraphAsTask
6. `run()` and `runPreview()` are strictly separate — no overlay, no merge, no second stage
