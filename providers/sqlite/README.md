# @workglow/sqlite

SQLite backends for @workglow/storage and @workglow/job-queue (includes sqlite-vector).

## Features

- Sqlite implementation of `@workglow/storage` interfaces
- Sqlite implementation of `@workglow/job-queue` interfaces
- Persistent storage for tasks, vectors, and queues

## Installation

```bash
npm install @workglow/sqlite
# or
bun add @workglow/sqlite
# or
yarn add @workglow/sqlite
```

## Usage

```typescript
import { SqliteTabularStorage } from "@workglow/sqlite/storage";
import { SqliteQueueStorage } from "@workglow/sqlite/job-queue";

const storage = new SqliteTabularStorage(connectionConfig);
const queue = new SqliteQueueStorage(connectionConfig);
```

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.
