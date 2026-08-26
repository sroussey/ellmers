<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Task Registry and Dynamic Composition

## 1. Overview

The **Task Registry** is the central catalog of task constructors in Workglow. It maps
human-readable type names (e.g. `"TextGenerationTask"`, `"DelayTask"`) to the class
constructors that implement them. Every subsystem that needs to create a task dynamically
-- JSON deserialization, the visual workflow builder, agent tool-calling, CLI introspection
-- resolves task types through this registry rather than hard-coding imports.

The registry lives in `@workglow/task-graph` and is exported as the singleton object
`TaskRegistry`. It is intentionally simple: a `Map<string, ITaskConstructor>` wrapped in
a thin API surface. Advanced scenarios (isolated test environments, multi-tenant
applications, per-request task allow-lists) are handled by a parallel **dependency-injection
(DI) integration** backed by the `TASK_CONSTRUCTORS` service token.

**Source file:** `packages/task-graph/src/task/TaskRegistry.ts`

### Key design goals

| Goal                                       | Mechanism                                                           |
| ------------------------------------------ | ------------------------------------------------------------------- |
| Runtime discovery of task types            | `TaskRegistry.all` (global `Map`)                                   |
| Dynamic instantiation from serialized data | `getTaskConstructors()` + `new taskClass(config)`                   |
| Scoped / sandboxed registries              | `TASK_CONSTRUCTORS` DI token per `ServiceRegistry`                  |
| Schema-driven input resolution             | `format: "tasks"` input resolver and compactor                      |
| Batch registration of built-in tasks       | `registerBaseTasks()`, `registerCommonTasks(options)`, `registerAiTasks()` |

---

## 2. TaskRegistry Class

`TaskRegistry` is a plain object -- not a class -- with two members:

```ts
export const TaskRegistry = {
  all: Map<string, ITaskConstructor<any, any, any>>,
  registerTask: (baseClass: ITaskConstructor<any, any, any>) => void,
};
```

### `TaskRegistry.registerTask(taskClass)`

Adds a task constructor to the global registry. The key is taken from the class's static
`type` property:

```ts
import { TaskRegistry } from "@workglow/task-graph";

TaskRegistry.registerTask(MyCustomTask);
// TaskRegistry.all.get("MyCustomTask") === MyCustomTask
```

If a task with the same `type` string is already registered, the new constructor
**silently replaces** it. This is intentional during development (hot-reload, test
overrides) but may be tightened in a future release.

### `TaskRegistry.all`

The underlying `Map<string, ITaskConstructor>`. Read it directly to enumerate, query, or
iterate over all registered tasks:

```ts
for (const [typeName, ctor] of TaskRegistry.all) {
  console.log(typeName, ctor.category, ctor.description);
}
```

Because `all` is a standard `Map`, you also have access to `.has()`, `.get()`,
`.delete()`, `.clear()`, and `.size` for imperative manipulation.

---

## 3. ITaskStaticProperties

Every task class that can be registered must satisfy the `ITaskStaticProperties` interface.
These are **static** members on the class itself (not on instances):

```ts
export interface ITaskStaticProperties {
  readonly type: string;
  readonly category?: string;
  readonly title?: string;
  readonly description?: string;
  readonly cachePolicy?: CachePolicy;
  readonly hasDynamicSchemas: boolean;
  readonly hasDynamicEntitlements: boolean;
  readonly passthroughInputsToOutputs?: boolean;
  readonly isGraphOutput?: boolean;
  readonly customizable?: boolean;
  readonly inputSchema: () => DataPortSchema;
  readonly outputSchema: () => DataPortSchema;
  readonly configSchema: () => DataPortSchema;
  readonly entitlements: () => TaskEntitlements;
}
```

### Property reference

| Property                     | Type                     | Required | Description                                                                                                                                   |
| ---------------------------- | ------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                       | `string`                 | Yes      | Unique identifier used as the registry key and in serialized JSON. By convention, matches the class name (e.g. `"DelayTask"`).                |
| `category`                   | `string`                 | No       | Grouping label for UI display. Common values: `"Utility"`, `"Flow Control"`, `"AI"`, `"String"`, `"Scalar"`, `"Vector"`, `"MCP"`, `"Hidden"`. |
| `title`                      | `string`                 | No       | Short human-readable label. Defaults to `""` in the `Task` base class.                                                                        |
| `description`                | `string`                 | No       | Longer explanation of what the task does. Used in CLI help, tooltips, and agent tool descriptions.                                            |
| `cachePolicy`                | `CachePolicy`            | Yes      | Whether and where the task's output can be cached given the same input. Tasks with side effects set this to `{ kind: "none" }`.               |
| `hasDynamicSchemas`          | `boolean`                | Yes      | When `true`, the task's input/output schemas can change at runtime (e.g. `GraphAsTask` recomputes schemas from its sub-graph).                |
| `hasDynamicEntitlements`     | `boolean`                | Yes      | When `true`, entitlements depend on runtime state (e.g. child tasks in a compound graph).                                                     |
| `passthroughInputsToOutputs` | `boolean`                | No       | When `true`, dynamically added input ports are mirrored as output ports of the same name and type.                                            |
| `isGraphOutput`              | `boolean`                | No       | Marks this task as the graph's output collector. The graph runner preferentially collects results from tasks with this flag.                  |
| `customizable`               | `boolean`                | No       | When `true`, this task can be saved as a custom preset with a frozen configuration in the workflow builder UI.                                |
| `inputSchema()`              | `() => DataPortSchema`   | Yes      | Returns the JSON Schema object describing the task's input ports.                                                                             |
| `outputSchema()`             | `() => DataPortSchema`   | Yes      | Returns the JSON Schema object describing the task's output ports.                                                                            |
| `configSchema()`             | `() => DataPortSchema`   | Yes      | Returns the JSON Schema for the task's configuration (persisted settings, not runtime data).                                                  |
| `entitlements()`             | `() => TaskEntitlements` | Yes      | Declares the permissions this task requires (network access, code execution, credential access, etc.).                                        |

### Default values from the Task base class

The `Task` base class provides sensible defaults so subclasses only override what differs:

```ts
public static type: TaskTypeName = "Task";
public static category: string = "Hidden";
public static title: string = "";
public static description: string = "";
public static cachePolicy: CachePolicy = { kind: "deterministic" };
public static hasDynamicSchemas: boolean = false;
public static hasDynamicEntitlements: boolean = false;
public static passthroughInputsToOutputs: boolean = false;
public static isGraphOutput: boolean = false;
public static customizable: boolean = false;
```

---

## 4. ITaskConstructor

`ITaskConstructor` is the intersection of the constructor signature and the static
properties interface:

```ts
type ITaskConstructorType<Input, Output, Config> = new (
  config: Config,
  runConfig?: Partial<IRunConfig>
) => ITask<Input, Output, Config>;

export type ITaskConstructor<Input, Output, Config> = ITaskConstructorType<Input, Output, Config> &
  ITaskStaticProperties;
```

This means any value stored in the registry is both:

1. **Callable with `new`** -- accepting a `TaskConfig` and optional `IRunConfig`.
2. **Queryable for metadata** -- `ctor.type`, `ctor.category`, `ctor.inputSchema()`, etc.

The JSON deserialization system relies on this dual nature. It looks up the constructor by
`type`, reads the static `inputSchema()` for validation, then calls `new taskClass(config)`
to instantiate:

```ts
const constructors = getTaskConstructors(registry);
const taskClass = constructors.get(item.type);
// taskClass is ITaskConstructor -- both metadata and constructor
const task = new taskClass({ id: item.id, defaults: item.defaults });
```

---

## 5. Self-Registration Pattern

The canonical pattern for a task module is to define the class, then register it at the
call site responsible for initialization. There are two approaches used in the codebase:

### Approach A: Batch registration via a factory function

This is the primary pattern. Tasks are imported and registered in a single function that
the application entry point calls:

```ts
// packages/tasks/src/common.ts
import { TaskRegistry } from "@workglow/task-graph";
import { DelayTask } from "./task/DelayTask";
import { FetchUrlTask } from "./task/FetchUrlTask";
// ... more imports

export const registerCommonTasks = () => {
  const tasks = [DelayTask, FetchUrlTask /* ... */];
  tasks.map(TaskRegistry.registerTask);
  return tasks;
};
```

### Approach B: Inline registration at module scope

Occasionally, test files or examples register tasks directly:

```ts
import { TaskRegistry } from "@workglow/task-graph";

class MyTestTask extends Task<TestInput, TestOutput> {
  static override readonly type = "MyTestTask";
  static override readonly category = "Test";
  // ...
}

TaskRegistry.registerTask(MyTestTask);
```

### Why batch registration?

Batch registration in an explicit function (rather than side-effect-on-import) prevents
**tree-shaking** from stripping task modules that appear unreferenced. It also makes the
set of registered tasks deterministic and easy to reason about at the application level.

---

## 6. DI Integration

### The `TASK_CONSTRUCTORS` service token

For advanced scenarios -- multi-tenant isolation, security sandboxing, testing -- the
registry supports a DI-based override through the `TASK_CONSTRUCTORS` service token:

```ts
export const TASK_CONSTRUCTORS =
  createServiceToken<Map<string, AnyTaskConstructor>>("task.constructors");
```

At module load time, the global `ServiceRegistry` is populated with a factory that returns
`TaskRegistry.all`:

```ts
if (!globalServiceRegistry.has(TASK_CONSTRUCTORS)) {
  globalServiceRegistry.register(
    TASK_CONSTRUCTORS,
    (): Map<string, AnyTaskConstructor> => TaskRegistry.all,
    true // singleton
  );
}
```

### `getTaskConstructors(registry?)`

This is the recommended way to read the constructors map. It checks the provided
`ServiceRegistry` first, then falls back to the global `TaskRegistry.all`:

```ts
export function getTaskConstructors(registry?: ServiceRegistry): Map<string, AnyTaskConstructor> {
  if (!registry) return TaskRegistry.all;
  return registry.has(TASK_CONSTRUCTORS) ? registry.get(TASK_CONSTRUCTORS) : TaskRegistry.all;
}
```

All internal call sites (JSON deserialization, agent tool resolution, input resolvers) call
`getTaskConstructors(registry)` rather than reading `TaskRegistry.all` directly. This
ensures that a scoped registry, when present, takes precedence.

### Creating a scoped registry

To create an isolated environment with a subset of tasks (e.g. for a sandboxed execution
context or a unit test):

```ts
import { Container, ServiceRegistry } from "@workglow/util";
import { TASK_CONSTRUCTORS } from "@workglow/task-graph";

function createScopedRegistry(
  allowedTasks: Array<ITaskConstructor<any, any, any>>
): ServiceRegistry {
  const container = new Container();
  const registry = new ServiceRegistry(container);
  const constructors = new Map<string, any>();
  for (const task of allowedTasks) {
    constructors.set(task.type, task);
  }
  registry.registerInstance(TASK_CONSTRUCTORS, constructors);
  return registry;
}

// Usage: only DelayTask and FetchUrlTask are available
const sandboxed = createScopedRegistry([DelayTask, FetchUrlTask]);
const task = createTaskFromGraphJSON(jsonItem, sandboxed);
```

### Helper functions

| Function                         | Description                                                          |
| -------------------------------- | -------------------------------------------------------------------- |
| `getGlobalTaskConstructors()`    | Returns the map from `globalServiceRegistry.get(TASK_CONSTRUCTORS)`. |
| `setGlobalTaskConstructors(map)` | Replaces the global factory with a fixed instance map.               |
| `getTaskConstructors(registry?)` | Registry-aware lookup with global fallback. The primary API.         |

---

## 7. Input Resolver -- `format: "tasks"`

The Task Registry integrates with Workglow's **input resolver** system, which automatically
converts lightweight string identifiers into rich objects at task execution time based on
`format` annotations in JSON Schemas.

### How it works

When a task's input schema annotates a property with `format: "tasks"`, the input resolver
pipeline intercepts string values for that property and resolves them to **tool definition
objects** by looking up the corresponding constructor in the registry.

```
Schema annotation          String value at runtime       Resolved object
---------------------      -------------------------     ----------------------
format: "tasks"            "FetchUrlTask"           -->  { name, description,
                                                           inputSchema,
                                                           outputSchema,
                                                           configSchema? }
```

### Registration

The resolver and its inverse (the compactor) are registered at module load time in
`TaskRegistry.ts`:

```ts
// Resolver: string task name --> tool definition object
registerInputResolver("tasks", resolveTaskFromRegistry);

// Compactor: tool definition object --> string task name
registerInputCompactor("tasks", (value, _format, registry) => {
  if (typeof value === "object" && value !== null && "name" in value) {
    const name = (value as Record<string, unknown>).name;
    if (typeof name !== "string") return undefined;
    const constructors = getTaskConstructors(registry);
    const ctor = constructors.get(name);
    return ctor ? name : undefined;
  }
  return undefined;
});
```

### Real-world usage: `AgentTask` and `ToolCallingTask`

The `AgentTask` and `ToolCallingTask` both accept a `tools` input that can contain either
string task names or inline tool definition objects:

```ts
// From AgentTask / ToolCallingTask input schema
tools: {
  type: "array",
  format: "tasks",
  title: "Tools",
  items: {
    oneOf: [
      { type: "string", format: "tasks", description: "Task type name" },
      ToolDefinitionSchema,
    ],
  },
}
```

At execution time, the input resolver automatically expands string entries like
`"FetchUrlTask"` into full tool definitions, while already-expanded objects pass through
unchanged. The compactor performs the reverse for serialization.

---

## 8. `registerCommonTasks()` and Batch Registration

Workglow organizes task registration into three tiers, each provided by a different
package:

### Registration tiers

| Function                | Package                | Tasks registered                                                                                                                                                                                                              |
| ----------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerBaseTasks()`   | `@workglow/task-graph` | `GraphAsTask`, `ConditionalTask`, `FallbackTask`, `MapTask`, `WhileTask`, `ReduceTask`                                                                                                                                        |
| `registerCommonTasks(options)` | `@workglow/tasks`      | ~50 utility tasks: `DelayTask`, `FetchUrlTask`, `JavaScriptTask`, `LambdaTask`, `MergeTask`, `SplitTask`, string/scalar/vector math tasks, MCP tasks, `JsonPathTask`, `RegexTask`, `TemplateTask`, `DateFormatTask`, and more |
| `registerAiTasks()`     | `@workglow/ai`         | ~40 AI tasks: `TextGenerationTask`, `TextEmbeddingTask`, `ImageClassificationTask`, `ChunkRetrievalTask`, `AgentTask`, `ToolCallingTask`, `StructuredGenerationTask`, and more                                                |

### Typical application bootstrap

```ts
import { registerBaseTasks } from "@workglow/task-graph";
import { registerCommonTasks } from "@workglow/tasks";
import { registerAiTasks } from "@workglow/ai";

// Register all built-in tasks
registerBaseTasks();
// `fileSystemTasks` is required: it decides whether FileGrepTask/FileLoaderTask/
// FileSedTask are resolvable by type name, including from graph JSON you did not author.
registerCommonTasks({ fileSystemTasks: false });
registerAiTasks();

// Register application-specific tasks
TaskRegistry.registerTask(MyCustomTask);
```

Each function returns the array of task classes it registered, which can be useful for
introspection or logging:

```ts
const aiTasks = registerAiTasks();
console.log(`Registered ${aiTasks.length} AI tasks`);
```

### Registration flow diagram

```
Application entry point
        |
        +--> registerBaseTasks()     --> TaskRegistry.all += [GraphAsTask, ConditionalTask, ...]
        |
        +--> registerCommonTasks()   --> TaskRegistry.all += [DelayTask, FetchUrlTask, ...]
        |
        +--> registerAiTasks()       --> TaskRegistry.all += [TextGenerationTask, AgentTask, ...]
        |
        +--> TaskRegistry.registerTask(CustomTask)
        |
        v
   TaskRegistry.all  (complete Map of all available task types)
        |
        +---> JSON deserialization     (createTaskFromGraphJSON / createTaskFromDependencyJSON)
        +---> Agent tool resolution    (AgentTask, ToolCallingTask)
        +---> CLI task listing         (workglow task list)
        +---> Visual workflow builder  (drag-and-drop palette)
        +---> Input resolver system    (format: "tasks" resolution)
```

---

## 9. Querying the Registry

### Finding a task by type name

```ts
const ctor = TaskRegistry.all.get("TextGenerationTask");
if (ctor) {
  console.log(ctor.type); // "TextGenerationTask"
  console.log(ctor.category); // "AI"
  console.log(ctor.description); // "Generates text using a language model"
  console.log(ctor.cachePolicy); // { kind: "deterministic" }
}
```

### Filtering by category

```ts
function getTasksByCategory(category: string): ITaskConstructor<any, any, any>[] {
  const result = [];
  for (const [, ctor] of TaskRegistry.all) {
    if (ctor.category === category) {
      result.push(ctor);
    }
  }
  return result;
}

const aiTasks = getTasksByCategory("AI");
const utilityTasks = getTasksByCategory("Utility");
```

### Listing all categories

```ts
const categories = new Set<string>();
for (const [, ctor] of TaskRegistry.all) {
  if (ctor.category) categories.add(ctor.category);
}
// Set { "Flow Control", "Utility", "AI", "String", "Scalar", "Vector", "MCP", ... }
```

### Inspecting schemas

```ts
const ctor = TaskRegistry.all.get("FetchUrlTask");
if (ctor) {
  const inputPorts = ctor.inputSchema(); // JSON Schema with properties
  const outputPorts = ctor.outputSchema();
  const config = ctor.configSchema();

  // List input port names
  if (typeof inputPorts !== "boolean" && inputPorts.properties) {
    console.log(Object.keys(inputPorts.properties));
  }
}
```

### Case-insensitive / fuzzy lookup

The CLI implements a lenient lookup that tries exact match first, then case-insensitive
matching with optional `Task` suffix:

```ts
function resolveTaskType(name: string): ITaskConstructor<any, any, any> | undefined {
  // Exact match
  const exact = TaskRegistry.all.get(name);
  if (exact) return exact;

  // Case-insensitive, with or without "Task" suffix
  const lower = name.toLowerCase();
  const candidates = [lower, lower.endsWith("task") ? lower.slice(0, -4) : lower + "task"];

  for (const [key, ctor] of TaskRegistry.all) {
    if (candidates.includes(key.toLowerCase())) {
      return ctor;
    }
  }
  return undefined;
}
```

---

## 10. API Reference

### `TaskRegistry` (singleton object)

| Member                    | Type                                           | Description                                                           |
| ------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| `all`                     | `Map<string, ITaskConstructor<any, any, any>>` | The global map of registered task constructors, keyed by `type` name. |
| `registerTask(taskClass)` | `(taskClass: ITaskConstructor) => void`        | Registers a task constructor. Uses `taskClass.type` as the key.       |

### DI tokens and helpers

| Export                           | Type                                          | Description                                                                                                                                                                 |
| -------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TASK_CONSTRUCTORS`              | `ServiceToken<Map<string, ITaskConstructor>>` | DI service token for scoped task constructor maps.                                                                                                                          |
| `getGlobalTaskConstructors()`    | `() => Map<string, ITaskConstructor>`         | Returns the task map from the global `ServiceRegistry`.                                                                                                                     |
| `setGlobalTaskConstructors(map)` | `(map: Map) => void`                          | Replaces the global task constructors with a fixed map instance.                                                                                                            |
| `getTaskConstructors(registry?)` | `(registry?: ServiceRegistry) => Map`         | Returns the task constructors from the given registry, falling back to the global `TaskRegistry.all`. **This is the primary lookup function used throughout the codebase.** |

### Batch registration functions

| Function                | Package                | Description                                                                                                                                                         |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerBaseTasks()`   | `@workglow/task-graph` | Registers flow-control tasks: `GraphAsTask`, `ConditionalTask`, `FallbackTask`, `MapTask`, `WhileTask`, `ReduceTask`. Returns the array of registered constructors. |
| `registerCommonTasks(options)` | `@workglow/tasks`      | Registers ~50 utility, string, scalar, vector, and MCP tasks, plus the three filesystem tasks when `options.fileSystemTasks` is true. Returns the array of registered constructors.                                                         |
| `registerAiTasks()`     | `@workglow/ai`         | Registers ~40 AI tasks spanning text, image, RAG, vision, and agent categories. Returns the array of registered constructors.                                       |

### Input resolver / compactor

| Registration                           | Format prefix | Direction         | Description                                                                                                                |
| -------------------------------------- | ------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `registerInputResolver("tasks", ...)`  | `"tasks"`     | string --> object | Converts a task type name to a tool definition object (`{ name, description, inputSchema, outputSchema, configSchema? }`). |
| `registerInputCompactor("tasks", ...)` | `"tasks"`     | object --> string | Extracts the `name` field from a tool definition and validates it exists in the registry, returning the string name.       |

### JSON deserialization functions

These functions use `getTaskConstructors(registry)` internally to look up constructors:

| Function                                                    | Description                                                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `createTaskFromDependencyJSON(item, registry?, options?)`   | Creates a task instance from a dependency-style JSON item. Recursively processes `subtasks` for compound tasks. |
| `createGraphFromDependencyJSON(items, registry?, options?)` | Creates a `TaskGraph` from an array of dependency-style JSON items.                                             |
| `createTaskFromGraphJSON(item, registry?, options?)`        | Creates a task instance from a graph-style JSON item (with `subgraph` instead of `subtasks`).                   |
| `createGraphFromGraphJSON(graphJson, registry?, options?)`  | Creates a complete `TaskGraph` with tasks and dataflows from graph-style JSON.                                  |

### `TaskDeserializationOptions`

```ts
interface TaskDeserializationOptions {
  readonly allowedTypes?: ReadonlySet<string> | readonly string[];
}
```

When provided to any deserialization function, only task types in the `allowedTypes` set
will be instantiated. Any other type throws a `TaskJSONError`. Use this to restrict which
tasks can be created from untrusted JSON input, as an additional layer of security beyond
scoped registries.

### Interfaces

#### `ITaskStaticProperties`

Defined in `packages/task-graph/src/task/ITask.ts`. Describes the static metadata that
every registerable task class must provide. See [Section 3](#3-itaskstaticproperties) for
the complete property table.

#### `ITaskConstructor<Input, Output, Config>`

Defined in `packages/task-graph/src/task/ITask.ts`. The intersection of the constructor
function type and `ITaskStaticProperties`:

```ts
type ITaskConstructor<Input, Output, Config> = (new (
  config: Config,
  runConfig?: Partial<IRunConfig>
) => ITask<Input, Output, Config>) &
  ITaskStaticProperties;
```

### Utility function: `taskTypesToTools()`

Defined in `@workglow/ai` (`packages/ai/src/task/ToolCallingTask.ts`). Converts an array of
task type names into tool definition objects for use with `ToolCallingTask` and `AgentTask`:

```ts
function taskTypesToTools(
  taskNames: ReadonlyArray<string>,
  registry?: ServiceRegistry
): ToolDefinitionWithTaskType[];
```

Each returned object includes `name`, `description`, `inputSchema`, `outputSchema`, an
optional `configSchema`, and the originating `taskType` string.

---

## Appendix: Defining a Custom Task

Bringing together all the concepts in this document, here is the complete pattern for
defining and registering a custom task:

```ts
import { Task, TaskRegistry } from "@workglow/task-graph";
import type { IExecuteContext } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

const inputSchema = {
  type: "object",
  properties: {
    text: { type: "string", title: "Text" },
    count: { type: "number", title: "Repeat count", default: 1 },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: { type: "string", title: "Result" },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

type RepeatInput = FromSchema<typeof inputSchema>;
type RepeatOutput = FromSchema<typeof outputSchema>;

export class RepeatTask extends Task<RepeatInput, RepeatOutput> {
  static override readonly type = "RepeatTask";
  static override readonly category = "String";
  static override readonly title = "Repeat";
  static override readonly description = "Repeats input text a specified number of times";
  static override readonly cachePolicy = { kind: "deterministic" } as const;

  static override inputSchema(): DataPortSchema {
    return inputSchema;
  }

  static override outputSchema(): DataPortSchema {
    return outputSchema;
  }

  async execute(input: RepeatInput, _context: IExecuteContext): Promise<RepeatOutput> {
    const count = input.count ?? 1;
    return { result: input.text.repeat(count) };
  }
}

// Register so the task is available for JSON deserialization, agent tools, etc.
TaskRegistry.registerTask(RepeatTask);
```

Once registered, this task can be:

- Instantiated from JSON: `createTaskFromGraphJSON({ id: "r1", type: "RepeatTask", defaults: { text: "hello", count: 3 } })`
- Used as an agent tool: `new AgentTask({ defaults: { tools: ["RepeatTask"] } })`
- Discovered by the CLI: `workglow task list` will show it under the "String" category
- Queried programmatically: `TaskRegistry.all.get("RepeatTask")?.description`
