# @workglow/supabase

Supabase backends for @workglow/storage and @workglow/job-queue.

## Features

- Supabase implementation of `@workglow/storage` interfaces
- Supabase implementation of `@workglow/job-queue` interfaces
- Persistent storage for tasks, vectors, and queues

## Installation

```bash
npm install @workglow/supabase
# or
bun add @workglow/supabase
# or
yarn add @workglow/supabase
```

## Usage

```typescript
import { SupabaseTabularStorage } from "@workglow/supabase/storage";
import { SupabaseQueueStorage } from "@workglow/supabase/job-queue";

const storage = new SupabaseTabularStorage(connectionConfig);
const queue = new SupabaseQueueStorage(connectionConfig);
```

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.
