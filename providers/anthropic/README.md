# @workglow/anthropic

Anthropic Claude provider for @workglow/ai.

## Features

- Integration with anthropic for Workglow AI tasks
- Supports standard Workglow AI task interfaces
- Works seamlessly with `@workglow/task-graph` and `@workglow/ai`
- Built-in job queue support for rate limiting and concurrency

## Installation

```bash
npm install @workglow/anthropic
# or
bun add @workglow/anthropic
# or
yarn add @workglow/anthropic
```

## Usage

```typescript
import { registerAnthropic } from "@workglow/anthropic/ai-runtime";
import { TextGenerationTask } from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";

// 1. Register the provider
await registerAnthropic();

// 2. Use it in a workflow
const workflow = new Workflow();
workflow.addTask(TextGenerationTask, {
  model: "default-model",
  prompt: "Hello world!",
});

const result = await workflow.run();
```

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.
