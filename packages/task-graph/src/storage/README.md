# Task Graph Storage Module

This module provides persistent storage solutions for task graphs and task outputs using various storage backends. The implementation follows a repository pattern with multiple concrete implementations for different storage technologies.

- [Task Output Repositories](#task-output-repositories)
- [Task Graph Repositories](#task-graph-repositories)
- [Testing](#testing)
- [Architecture Notes](#architecture-notes)
- [License](#license)

## Task Output Repositories

TaskOutputRepository is a repository for task caching. If a task has the same input it is assumed to return the same output. The task graph runner does not resume, but you can quickly get to the aborted state by using the output repository and re-running the task graph.

```typescript
// Example usage
import {
  tabularTaskOutputStorage,
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
  TaskOutputTabularRepository,
} from "@workglow/task-graph";
import { SqliteTabularStorage } from "@workglow/storage";
import { Sqlite } from "@workglow/storage/sqlite";

await Sqlite.init();

const outputRepo = new TaskOutputTabularRepository({
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
await outputRepo.saveOutput("MyTaskType", { param: "value" }, { result: "data" });
```

## Task Graph Repositories

TaskGraphRepository is a repository for task graphs themselves. It is used to save and load task graphs.

The `TaskGraphRepository` class provides:

- CRUD operations for task graphs
- Event emitters for storage operations
- Serialization/deserialization of task graphs with data flows

```typescript
// Example usage
import {
  TaskGraphPrimaryKeyNames,
  TaskGraphSchema,
  TaskGraphTabularRepository,
} from "@workglow/task-graph";
import {
  FsFolderTabularStorage,
  InMemoryTabularStorage,
  SqliteTabularStorage,
} from "@workglow/storage";
import { Sqlite } from "@workglow/storage/sqlite";

const fsRepo = new TaskGraphTabularRepository({
  tabularRepository: new FsFolderTabularStorage(
    "./storage",
    TaskGraphSchema,
    TaskGraphPrimaryKeyNames
  ),
});
const memoryRepo = new TaskGraphTabularRepository({
  tabularRepository: new InMemoryTabularStorage(TaskGraphSchema, TaskGraphPrimaryKeyNames),
});

await Sqlite.init();
const sqliteRepo = new TaskGraphTabularRepository({
  tabularRepository: new SqliteTabularStorage(
    ":memory:",
    "task_graphs",
    TaskGraphSchema,
    TaskGraphPrimaryKeyNames
  ),
});
```

## Testing

Tests are written using Bun test runner. To run tests:

```bash
bun test
```

Tests include:

- Generic repository tests that run against all implementations
- Storage-specific test suites

## Architecture Notes

- All repositories use a TabularStorage pattern internally
- Schema definitions are centralized in `TaskGraphSchema`/`TaskOutputSchema`
- Primary key configurations are managed through `PrimaryKeyNames` constants
- Event emitters provide hooks for monitoring repository operations

## License

Apache 2.0 - See LICENSE file for details
