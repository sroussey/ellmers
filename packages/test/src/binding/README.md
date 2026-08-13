# TaskGraph Storage Module Bindings

These are bindings for the task graph storage module for use in the test suite and getting started guides.

- [Task Output Repositories](#task-output-repositories)
- [Task Graph Repositories](#task-graph-repositories)
- [Testing](#testing)
- [Architecture Notes](#architecture-notes)
- [License](#license)

## Task Output Repositories

TaskOutputRepository is a repository for task caching.

Available Binding Implementations:

- **InMemoryTaskOutputRepository**: Volatile in-memory storage
- **FsFolderTaskOutputRepository**: File system storage
- **IndexedDbTaskOutputRepository**: IndexedDB storage
- **SqliteTaskOutputRepository**: SQLite storage
- **StreamingSqliteTaskOutputRepository** / **StreamingPostgresTaskOutputRepository** / **StreamingSupabaseTaskOutputRepository**: SQL backings that additionally stream port payloads as ordered blob chunk rows

All implementations extend `TaskOutputRepository` abstract class and provide:

- Task-type specific storage
- Event emitters for storage operations

```typescript
// Example usage (SQLite bindings require Sqlite.init first)
import { Sqlite } from "@workglow/storage/sqlite";

await Sqlite.init();
const outputRepo = new SqliteTaskOutputRepository(":memory:");
await outputRepo.saveOutput("MyTaskType", { param: "value" }, { result: "data" });
```

## Task Graph Repositories

TaskGraphRepository is a repository for task graphs themselves. It is used to save and load task graphs.

Available Binding Implementations:

- **InMemoryTaskGraphRepository**: Volatile in-memory storage (good for testing)
- **FsFolderTaskGraphRepository**: File system storage using JSON files
- **IndexedDbTaskGraphRepository**: Browser-based IndexedDB storage
- **SqliteTaskGraphRepository**: SQLite database storage

All implementations extend `TaskGraphRepository` class and provide storage for task graphs.

```typescript
// Example usage
const fsRepo = new FsFolderTaskGraphRepository("./storage");
const memoryRepo = new InMemoryTaskGraphRepository();
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
