# @workglow/huggingface-inference

HuggingFace Inference API provider for @workglow/ai-provider.

## Features

- Integration with huggingface-inference for Workglow AI tasks
- Supports standard Workglow AI task interfaces
- Works seamlessly with `@workglow/task-graph` and `@workglow/ai`
- Built-in job queue support for rate limiting and concurrency

## Installation

```bash
npm install @workglow/huggingface-inference
# or
bun add @workglow/huggingface-inference
# or
yarn add @workglow/huggingface-inference
```

## Usage

```typescript
import { registerHuggingfaceInference } from "@workglow/huggingface-inference/ai-provider-runtime";
import { TextGenerationTask } from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";

// 1. Register the provider
await registerHuggingfaceInference();

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
