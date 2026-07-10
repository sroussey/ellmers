# @workglow/xai

xAI (Grok) provider for @workglow/ai.

xAI exposes an OpenAI-compatible REST API, so this provider reuses the `openai`
SDK pointed at `https://api.x.ai/v1`. It covers Grok chat/reasoning models
(text generation, tool use, structured/JSON output, rewriting, summarization,
vision input) and Grok image generation.

## Features

- Integration with the xAI Grok API for Workglow AI tasks
- Supports standard Workglow AI task interfaces
- Works seamlessly with `@workglow/task-graph` and `@workglow/ai`
- Built-in job queue support for rate limiting and concurrency

## Installation

```bash
npm install @workglow/xai
# or
bun add @workglow/xai
# or
yarn add @workglow/xai
```

## Usage

```typescript
import { registerXaiInline } from "@workglow/xai/ai-runtime";
import { getGlobalModelRepository } from "@workglow/ai";
import { XAI } from "@workglow/xai/ai";
import { TextGenerationTask } from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";

// 1. Register the provider (reads XAI_API_KEY from the environment)
await registerXaiInline();

// 2. Register a Grok model
await getGlobalModelRepository().addModel({
  model_id: "xai:grok-4",
  title: "Grok 4",
  description: "xAI Grok 4",
  capabilities: ["text.generation", "tool-use", "json-mode", "vision-input"],
  provider: XAI,
  provider_config: { model_name: "grok-4" },
  metadata: {},
});

// 3. Use it in a workflow
const workflow = new Workflow();
workflow.add(
  new TextGenerationTask({
    model: "xai:grok-4",
    prompt: "Hello world!",
  })
);

const result = await workflow.run();
```

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.
