# @workglow/tf-mediapipe

TensorFlow MediaPipe provider for @workglow/ai-provider (browser only).

## Features

- Integration with tf-mediapipe for Workglow AI tasks
- Supports standard Workglow AI task interfaces
- Works seamlessly with `@workglow/task-graph` and `@workglow/ai`
- Built-in job queue support for rate limiting and concurrency

## Installation

```bash
npm install @workglow/tf-mediapipe
# or
bun add @workglow/tf-mediapipe
# or
yarn add @workglow/tf-mediapipe
```

## Usage

```typescript
import { registerTfMediapipe } from "@workglow/tf-mediapipe/ai-provider-runtime";
import { TextGenerationTask } from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";

// 1. Register the provider
await registerTfMediapipe();

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
