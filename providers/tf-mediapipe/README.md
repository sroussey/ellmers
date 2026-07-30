# @workglow/tf-mediapipe

TensorFlow MediaPipe provider for @workglow/ai (browser only).

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
import { registerTensorFlowMediaPipeInline } from "@workglow/tf-mediapipe/ai-runtime";
import { getGlobalModelRepository, TextGenerationTask } from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";

// 1. Register the provider (inline; see registerTensorFlowMediaPipe for worker-backed)
await registerTensorFlowMediaPipeInline();

// 2. Register an LLM model (Gemma 3 1B, int4 web bundle — requires WebGPU)
await getGlobalModelRepository().addModel({
  model_id: "gemma3-1b-it",
  title: "Gemma 3 1B IT",
  description: "On-device LLM via MediaPipe",
  capabilities: ["text.generation", "json-mode", "model.count-tokens"],
  provider: "TENSORFLOW_MEDIAPIPE",
  provider_config: {
    task_engine: "genai",
    pipeline: "genai-text",
    model_path:
      "https://huggingface.co/litert-community/Gemma3-1B-IT/resolve/main/gemma3-1b-it-int4-web.task",
    max_tokens: 1000,
  },
  metadata: {},
});

// 3. Use it in a workflow (streams tokens as they generate)
const workflow = new Workflow();
workflow.pipe(new TextGenerationTask({ model: "gemma3-1b-it", prompt: "Hello!" }));
const result = await workflow.run();
```

### GPU acceleration

`provider_config.gpu` defaults to `true`: vision tasks use the MediaPipe GPU
delegate (with automatic CPU fallback when GPU creation fails), and genai LLM
inference always runs on WebGPU (a clear error is raised when WebGPU is
unavailable). Text and audio tasks are CPU-only on web and ignore the flag.

### GenAI notes

- Chat and prompt inputs are rendered with the Gemma turn format by default
  (`provider_config.chat_template: "gemma" | "none"`).
- `max_tokens` (combined input+output budget), `top_k`, `temperature`, and
  `random_seed` are set at model load from `provider_config`; a per-run
  `temperature` input is applied via `setOptions` without reloading.
- Structured generation (`json-mode`) is prompt-engineered; the task layer
  validates against the output schema and retries.

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.
