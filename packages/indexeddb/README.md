# @workglow/indexeddb

IndexedDB backends for @workglow/storage and @workglow/job-queue.

## Features

- IndexedDB implementation of `@workglow/storage` interfaces
- IndexedDB implementation of `@workglow/job-queue` interfaces
- Works in browser environments
- Persistent local storage for tasks and queues

## Installation

```bash
npm install @workglow/indexeddb
# or
bun add @workglow/indexeddb
# or
yarn add @workglow/indexeddb
```

## Usage

```typescript
import { IndexedDbTabularStorage } from "@workglow/indexeddb/storage";
import { IndexedDbQueueStorage } from "@workglow/indexeddb/job-queue";

const storage = new IndexedDbTabularStorage("my-database");
const queue = new IndexedDbQueueStorage("my-queue");
```

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.
