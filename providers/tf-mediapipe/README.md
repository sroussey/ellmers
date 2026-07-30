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

// 2. Register an LLM model (Qwen2.5 1.5B, int8 bundle — requires WebGPU)
await getGlobalModelRepository().addModel({
  model_id: "qwen2.5-1.5b-instruct",
  title: "Qwen2.5 1.5B Instruct",
  description: "On-device LLM via MediaPipe",
  capabilities: [
    "text.generation",
    "json-mode",
    "model.count-tokens",
    "model.download-remove",
    "model.info",
    "model.search",
  ],
  provider: "TENSORFLOW_MEDIAPIPE",
  provider_config: {
    task_engine: "genai",
    pipeline: "genai-text",
    model_path:
      "https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct/resolve/main/Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv1280.task",
    max_tokens: 1280,
    chat_template: "chatml",
  },
  metadata: {},
});

// 3. Use it in a workflow (streams tokens as they generate)
const workflow = new Workflow();
workflow.pipe(new TextGenerationTask({ model: "qwen2.5-1.5b-instruct", prompt: "Hello!" }));
const result = await workflow.run();
```

### GPU acceleration

`provider_config.gpu` defaults to `true`: vision tasks use the MediaPipe GPU
delegate (with automatic CPU fallback when GPU creation fails), and genai LLM
inference always runs on WebGPU (a clear error is raised when WebGPU is
unavailable). Text and audio tasks are CPU-only on web and ignore the flag.

### GenAI notes

- Chat and prompt inputs are rendered with the Gemma turn format by default
  (`provider_config.chat_template: "gemma" | "chatml" | "none"`).
- `max_tokens` (combined input+output budget), `top_k`, `temperature`, and
  `random_seed` are fixed at model load from `provider_config` — the web SDK
  cannot change sampler options after load, so per-run temperature inputs are
  ignored.
- Gemma bundles on Hugging Face are license-gated (anonymous downloads fail);
  accept the Gemma license and host the file yourself, or use an ungated bundle
  such as Qwen2.5 (`chat_template: "chatml"`).
- Structured generation (`json-mode`) is prompt-engineered; the task layer
  validates against the output schema and retries.

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.
