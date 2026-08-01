# @workglow/ollama

Ollama provider for @workglow/ai.

## Features

- Integration with ollama for Workglow AI tasks
- Supports standard Workglow AI task interfaces
- Works seamlessly with `@workglow/task-graph` and `@workglow/ai`
- Built-in job queue support for rate limiting and concurrency

## Installation

```bash
npm install @workglow/ollama
# or
bun add @workglow/ollama
# or
yarn add @workglow/ollama
```

## Usage

```typescript
import { registerOllama } from "@workglow/ollama/ai-runtime";
import { TextGenerationTask } from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";

// 1. Register the provider
await registerOllama();

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
