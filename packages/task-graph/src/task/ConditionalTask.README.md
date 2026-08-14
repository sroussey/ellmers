# ConditionalTask

A task that implements conditional branching within a task graph, similar to if/then/else or switch/case statements.

## Overview

`ConditionalTask` evaluates configured conditions against its input and selectively enables output ports for active branches. Inactive branches result in `DISABLED` status for their downstream dataflows, which cascades to disable unreachable downstream tasks.

## Key Features

- **Condition-based routing**: Route data to different downstream tasks based on input values
- **Exclusive mode (default)**: Act as a switch/case where only the first matching branch activates
- **Multi-path mode**: Enable multiple branches simultaneously when conditions match
- **Default branch**: Specify a fallback branch when no conditions match
- **Disabled propagation**: Inactive branches result in DISABLED status for downstream tasks

## Basic Usage

### Simple If/Else

```typescript
import { ConditionalTask, TaskGraph, Dataflow } from "@workglow/task-graph";

const conditional = new ConditionalTask(
  {},
  {
    branches: [
      { id: "high", condition: (i) => i.value > 100, outputPort: "highPath" },
      { id: "low", condition: (i) => i.value <= 100, outputPort: "lowPath" },
    ],
  }
);

const highHandler = new SomeTask({}, { id: "highHandler" });
const lowHandler = new SomeTask({}, { id: "lowHandler" });

const graph = new TaskGraph();
graph.addTasks([conditional, highHandler, lowHandler]);
graph.addDataflow(new Dataflow(conditional.id, "highPath", highHandler.id, "*"));
graph.addDataflow(new Dataflow(conditional.id, "lowPath", lowHandler.id, "*"));

// When value > 100, highHandler runs and lowHandler is DISABLED
// When value <= 100, lowHandler runs and highHandler is DISABLED
await graph.run({ value: 150 });
```

### Switch/Case Pattern

```typescript
const statusRouter = new ConditionalTask(
  {},
  {
    branches: [
      { id: "active", condition: (i) => i.status === "active", outputPort: "active" },
      { id: "pending", condition: (i) => i.status === "pending", outputPort: "pending" },
      { id: "inactive", condition: (i) => i.status === "inactive", outputPort: "inactive" },
    ],
    defaultBranch: "inactive", // Fallback if no match
    exclusive: true, // Only first match activates (default)
  }
);
```

### Multi-Path Fan-Out

```typescript
const fanOut = new ConditionalTask(
  {},
  {
    branches: [
      { id: "log", condition: () => true, outputPort: "logger" },
      { id: "process", condition: () => true, outputPort: "processor" },
      { id: "archive", condition: (i) => i.shouldArchive, outputPort: "archiver" },
    ],
    exclusive: false, // All matching branches activate
  }
);
```

## Configuration

### BranchConfig

Each branch in the `branches` array has the following properties:

| Property     | Type                 | Description                      |
| ------------ | -------------------- | -------------------------------- |
| `id`         | `string`             | Unique identifier for the branch |
| `condition`  | `(input) => boolean` | Predicate function to evaluate   |
| `outputPort` | `string`             | Output port name for this branch |

### ConditionalTaskConfig

| Property        | Type             | Default     | Description                                   |
| --------------- | ---------------- | ----------- | --------------------------------------------- |
| `branches`      | `BranchConfig[]` | Required    | Array of branch configurations                |
| `defaultBranch` | `string`         | `undefined` | Branch ID to use if no conditions match       |
| `exclusive`     | `boolean`        | `true`      | If true, only first matching branch activates |

## Execution Modes

### Exclusive Mode (Default)

In exclusive mode (`exclusive: true`), branches are evaluated in order and only the first matching branch becomes active. This is similar to a switch/case statement or if/else-if chain.

```typescript
const router = new ConditionalTask(
  {},
  {
    branches: [
      { id: "tier1", condition: (i) => i.value > 1000, outputPort: "tier1" },
      { id: "tier2", condition: (i) => i.value > 100, outputPort: "tier2" },
      { id: "tier3", condition: (i) => i.value > 0, outputPort: "tier3" },
    ],
    exclusive: true,
  }
);

// With value = 500:
// - tier1 condition: 500 > 1000 = false
// - tier2 condition: 500 > 100 = true ← ACTIVATES, stops here
// - tier3 is NOT evaluated (exclusive mode)
```

### Multi-Path Mode

In multi-path mode (`exclusive: false`), all branches whose conditions evaluate to true become active simultaneously. This enables fan-out patterns.

```typescript
const multiRouter = new ConditionalTask(
  {},
  {
    branches: [
      { id: "even", condition: (i) => i.value % 2 === 0, outputPort: "evenPath" },
      { id: "div3", condition: (i) => i.value % 3 === 0, outputPort: "div3Path" },
      { id: "div5", condition: (i) => i.value % 5 === 0, outputPort: "div5Path" },
    ],
    exclusive: false,
  }
);

// With value = 30:
// - even: 30 % 2 === 0 = true ← ACTIVATES
// - div3: 30 % 3 === 0 = true ← ACTIVATES
// - div5: 30 % 5 === 0 = true ← ACTIVATES
// All three downstream tasks will run!
```

## Output Behavior

There are two output shapes, selected by how the branches were supplied. The
instance `outputSchema()` describes whichever one applies, so dataflows wired
off either shape pass the graph's compatibility check.

### Function branches (`config.branches` with `ConditionFn`)

For each active branch, the task passes through its entire input to that branch's output port:

```typescript
// Input: { value: 150, metadata: { source: "api" } }

// Output when "high" branch is active:
{
  _activeBranches: ["high"],
  highPath: { value: 150, metadata: { source: "api" } }
}
```

The `_activeBranches` property is always present and contains the IDs of all
active branches. It is metadata, not a branch port: an edge wired off it follows
the task's own status and is never disabled.

### Serialized `conditionConfig` (from `config` or the input port)

The UI condition builder supplies branches as data rather than functions. In that
mode each **input port** is re-emitted with a branch suffix — `<port>_<n>` for
branch _n_ (1-based), and `<port>_else` when the config is exclusive — and there
is **no** `_activeBranches` property:

```typescript
const gate = new ConditionalTask({
  inputSchema: {
    type: "object",
    properties: {
      categories: { type: "array", items: { type: "string" } },
      message: { type: "string" },
    },
  },
  conditionConfig: {
    branches: [{ id: "confident", field: "score", operator: "greater_or_equal", value: "0.8" }],
    exclusive: true,
  },
});

// Ports: categories_1, message_1, categories_else, message_else

// Input: { score: 0.9, categories: ["billing"], message: "hello" }
// Output (the "confident" branch matched):
{
  categories_1: ["billing"],
  message_1: "hello"
}
// Input: { score: 0.2, ... } -> { categories_else: [...], message_else: "..." }
```

Each derived port carries its input port's own schema, so types survive the gate.
The `conditionConfig` input is control data and is never routed to an output port.
In non-exclusive mode the `_else` ports do not exist and every matching branch's
ports activate independently.

Declaring `config.inputSchema` is what makes these ports derivable. When it is
absent — or when the `conditionConfig` arrives only on the input port at runtime —
the output schema stays fully open, so edges still resolve (as `"runtime"`
compatibility) but carry no static type.

## Dataflow Wiring

When wiring ConditionalTask outputs to downstream tasks, use `"*"` (DATAFLOW_ALL_PORTS) as the target port to pass all properties from the branch output:

```typescript
// Pass all properties from the branch output to the downstream task
graph.addDataflow(
  new Dataflow(
    conditional.id,
    "highPath", // Source port (branch output)
    handler.id,
    "*" // Target: all ports (passes { value, metadata, ... })
  )
);
```

## Disabled Status Propagation

When a branch is inactive, its outgoing dataflow is set to `DISABLED` status. The graph runner then propagates this status:

1. If ALL incoming dataflows to a task are `DISABLED`, that task becomes `DISABLED`
2. The disabled task's outgoing dataflows are also set to `DISABLED`
3. This cascades through the graph until no more tasks can be disabled

This ensures that tasks which cannot receive data (because all paths to them are disabled) don't run unnecessarily.

## Inspecting Branch Status

After execution, you can inspect which branches were activated:

```typescript
await conditionalTask.run({ value: 150 });

// Check individual branch
if (conditionalTask.isBranchActive("high")) {
  console.log("High value path was taken");
}

// Get all active branches
const active = conditionalTask.getActiveBranches();
console.log("Active branches:", Array.from(active));

// Get port status map
const portStatus = conditionalTask.getPortActiveStatus();
for (const [port, isActive] of portStatus) {
  console.log(`Port ${port}: ${isActive ? "active" : "inactive"}`);
}
```

`getPortActiveStatus()` covers both output shapes and is what the scheduler reads
to decide which outgoing dataflows are `COMPLETED` and which are `DISABLED`. It
lists every port the run could have written, not just the ones it did — a port
missing from the map is not a branch port and follows the task's own status.
That list is the declared input ports union the ones that actually arrived, and
activation follows the **branch**: a declared port that arrived empty still
belongs to the taken branch, so its edge stays enabled.

## Caching

`ConditionalTask` declares `cacheable = false`, and must stay that way. Its real
product is the routing decision the scheduler reads back off the instance, and a
cache hit returns the output without entering `execute`, so that state is never
populated. A cached gate mis-routes in both modes: a `conditionConfig` gate
reports no branch ports at all (nothing is disabled, so the untaken branch runs)
and a function-branch gate reports every port inactive (everything is disabled,
so the taken branch does not run). Evaluating a condition is cheap — there is
nothing here worth caching.

## Events

ConditionalTask emits a custom event after branch evaluation:

```typescript
conditionalTask.on("branches_evaluated", (activeBranches: Set<string>) => {
  console.log("Active branches:", Array.from(activeBranches));
});
```

## Error Handling

If a condition function throws an error, the branch is treated as if the condition returned `false`:

```typescript
const router = new ConditionalTask(
  {},
  {
    branches: [
      {
        id: "risky",
        condition: (i) => {
          if (!i.data) throw new Error("No data!");
          return i.data.value > 100;
        },
        outputPort: "risky",
      },
      { id: "safe", condition: () => true, outputPort: "safe" },
    ],
  }
);

// If input.data is undefined:
// - "risky" condition throws, treated as false
// - "safe" condition returns true, becomes active
// Console warning: Condition evaluation failed for branch "risky": Error: No data!
```

## Integration with Task Graph

ConditionalTask integrates seamlessly with TaskGraph and its scheduler:

1. ConditionalTask executes and determines active branches
2. Graph runner sets dataflow status based on branch activation
3. Scheduler respects DISABLED status when determining ready tasks
4. Downstream tasks on disabled branches never execute

This makes ConditionalTask ideal for implementing:

- Feature flags
- A/B testing
- Error handling and retry logic
- Priority-based routing
- Validation pipelines
- Any workflow that requires conditional execution paths
