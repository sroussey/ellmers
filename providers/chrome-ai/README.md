# @workglow/chrome-ai

Chrome built-in AI provider for @workglow/ai-provider.

## Features

- Integration with chrome-ai for Workglow AI tasks
- Supports standard Workglow AI task interfaces
- Works seamlessly with `@workglow/task-graph` and `@workglow/ai`
- Built-in job queue support for rate limiting and concurrency

## Installation

```bash
npm install @workglow/chrome-ai
# or
bun add @workglow/chrome-ai
# or
yarn add @workglow/chrome-ai
```

## Usage

```typescript
import { registerChromeAi } from "@workglow/chrome-ai/ai-provider-runtime";
import { TextGenerationTask } from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";

// 1. Register the provider
await registerChromeAi();

// 2. Use it in a workflow
const workflow = new Workflow();
workflow.add(new TextGenerationTask({
  model: "default-model",
  prompt: "Hello world!"
}));

const result = await workflow.run();
```

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.
