# @workglow/postgres

Postgres backends for @workglow/storage and @workglow/job-queue.

## Features

- Postgres implementation of `@workglow/storage` interfaces
- Postgres implementation of `@workglow/job-queue` interfaces
- Persistent storage for tasks, vectors, and queues

## Installation

```bash
npm install @workglow/postgres
# or
bun add @workglow/postgres
# or
yarn add @workglow/postgres
```

## Usage

```typescript
import { PostgresTabularStorage } from "@workglow/postgres/storage";
import { PostgresQueueStorage } from "@workglow/postgres/job-queue";

const storage = new PostgresTabularStorage(connectionConfig);
const queue = new PostgresQueueStorage(connectionConfig);
```

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.
