# @workglow/huggingface-transformers

HuggingFace Transformers.js provider for @workglow/ai-provider.

## Features

- Integration with huggingface-transformers for Workglow AI tasks
- Supports standard Workglow AI task interfaces
- Works seamlessly with `@workglow/task-graph` and `@workglow/ai`
- Built-in job queue support for rate limiting and concurrency

## Installation

```bash
npm install @workglow/huggingface-transformers
# or
bun add @workglow/huggingface-transformers
# or
yarn add @workglow/huggingface-transformers
```

## Usage

```typescript
import { registerHuggingfaceTransformers } from "@workglow/huggingface-transformers/ai-provider-runtime";
import { TextGenerationTask } from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";

// 1. Register the provider
await registerHuggingfaceTransformers();

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
