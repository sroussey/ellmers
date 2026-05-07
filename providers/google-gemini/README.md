# @workglow/google-gemini

Google Gemini provider for @workglow/ai-provider.

## Features

- Integration with google-gemini for Workglow AI tasks
- Supports standard Workglow AI task interfaces
- Works seamlessly with `@workglow/task-graph` and `@workglow/ai`
- Built-in job queue support for rate limiting and concurrency

## Installation

```bash
npm install @workglow/google-gemini
# or
bun add @workglow/google-gemini
# or
yarn add @workglow/google-gemini
```

## Usage

```typescript
import { registerGoogleGemini } from "@workglow/google-gemini/ai-provider-runtime";
import { TextGenerationTask } from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";

// 1. Register the provider
await registerGoogleGemini();

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
