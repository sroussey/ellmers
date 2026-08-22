# Workglow CLI Example

A command-line interface for running Workglow AI tasks and workflows.

## Overview

The Workglow CLI provides a terminal-based interface for creating, managing, and executing AI task pipelines. It features an interactive task runner with real-time progress visualization, making it easy to run AI workflows from the command line.

## Features

- **Real-time Visualization**: Live updates of task execution progress
- **Multi-Provider Support**: Works with HuggingFace Transformers and TensorFlow MediaPipe
- **Local AI Models**: Run AI models locally without external API calls
- **JSON Configuration**: Define workflows using JSON configuration files

## Getting Started

### Prerequisites

- Bun runtime (recommended) or Node.js 18+
- Terminal with Unicode support for best experience

### Installation

```bash
bun install @workglow/cli
```

### Running

```bash
bun src/workglow.ts
```

## Usage

### Basic Commands

```bash
# Show help
workglow --help

# Run a simple text generation task
workglow generate --model "onnx:Xenova/LaMini-Flan-T5-783M:q8" "Write a story about a robot"

# Create an embedding from text
workglow embedding --model "onnx:Xenova/LaMini-Flan-T5-783M:q8" "Hello world"
```

### Example Workflows

#### Text Generation

```bash
workglow generate \
  --text "The future of AI is" \
  --model "onnx:Xenova/LaMini-Flan-T5-783M:q8" \
  --max-length 100
```

#### Workflow from JSON

Create a `workflow.json` file:

```json
[
  {
    "type": "ModelDownload",
    "config": {
      "model": ["onnx:Xenova/LaMini-Flan-T5-783M:q8"]
    }
  },
  {
    "type": "TextRewriter",
    "config": {
      "text": "The quick brown fox jumps over the lazy dog.",
      "prompt": "Rewrite this text to sound like a pirate:"
    }
  },
  {
    "type": "DebugLog",
    "config": {
      "log_level": "info"
    }
  }
]
```

Then run:

```bash
cat workflow.json | workglow json
```

## Command Reference

### Global Options

- `--version, -v`: Show version information
- `--help, -h`: Show help information

### Commands

#### `generate`

Generate text using AI models.

```bash
workglow generate [options] <text>
```

Options:

- `--model, -m <model>`: AI model to use
- `--max-length <length>`: Maximum output length
- `--temperature <temp>`: Sampling temperature (0.0-1.0)

## Web console

`workglow web` serves a local page for the same commands the terminal runs:
pick one, fill in its options, press Run, and watch the task graph execute
live. Nothing is duplicated — the command tree is read off the commander
program, the form fields come from the same schemas the terminal prompts
from, and the line at the bottom of the form is exactly what gets executed.

```sh
workglow web                 # http://127.0.0.1:8787/?t=<session token>
workglow web --port 9000
```

The console binds **loopback** and has no authentication beyond a per-process
session token printed in the URL. Its buttons start runs that spend model and
API quota, so exposing it to a network has to be said out loud (`--host`),
and the command warns when you do.

### How a run works

Each run is a **child process of the same binary**, spawned with the argv the
page shows you, and handed two extra descriptors: fd 3 for a stream of run
events (NDJSON — one line per task added, status, progress, token usage,
stream chunk) and fd 4 for answers to anything the run asks its operator. The
server replays that stream over SSE, so the page mounts once and is patched
per event, and a reconnect resumes from `Last-Event-ID` rather than starting
over.

That shape is why the console works for commands nobody wrote it for: the
reporting branch lives in `withCli`, which every command in this package —
and in every CLI built on it — already runs its graphs through. It also means
a per-run environment override belongs to that run rather than to the server,
and that aborting is the same SIGINT Ctrl-C sends.

### Adding the console to your own CLI

```ts
import { registerWebCommand } from "@workglow/cli";

registerWebCommand(program, { binaryName: "sec" });
```

Your commands, however deeply nested, appear with nothing to keep in sync.

### Contributing UI from a package

Data crosses this seam, never code — a package registers what to show, and the
console renders it. There is no client bundle to ship and no plugin loader to
keep stable.

```ts
import { registerWebPanel, registerWebFieldWidget, registerWebStatusWidget } from "@workglow/cli";

// An extra panel on a finished run's Result tab.
registerWebPanel({
  id: "sec:extractions",
  title: "Extraction rows",
  source: "@workglow/sec",
  appliesTo: (invocation) => invocation.path[0] === "spac",
  load: async ({ invocation }) => ({
    kind: "table",
    columns: ["table", "rows"],
    rows: await countRowsForIssuer(invocation.args[0]),
  }),
});

// A picker for any field whose schema says `format: "sec:cik"`.
registerWebFieldWidget({
  format: "sec:cik",
  source: "@workglow/sec",
  search: async (query) => findIssuers(query),
});

// A meter in the rail.
registerWebStatusWidget({
  id: "sec:edgar",
  title: "EDGAR fetch budget",
  source: "@workglow/sec",
  read: async () => [{ label: "req/s", value: currentRate(), max: 8 }],
});
```

A panel that throws is reported as a panel rather than taking the page down,
and a status widget that cannot answer is dropped from the rail.

A command whose real input lives in a schema can say so, which is how
`task run` and `workflow run` get their forms:

```ts
import { registerCommandSchemaProvider } from "@workglow/cli";

registerCommandSchemaProvider({
  path: ["spac", "process"],
  resolve: async (args) => ({ input: schemaForIssuer(args[0]), config: undefined }),
});
```

## Configuration

### Model Configuration

The CLI automatically downloads and caches AI models. You can configure model settings:

## Development

### Project Structure

```
src/
├── workglow.ts              # Main CLI entry point
├── TaskCLI.ts             # CLI command definitions
├── TaskGraphToUI.ts       # Terminal UI components
├── components/            # Reusable CLI components
├── lib.ts                 # Library exports
└── worker_hft.ts          # HuggingFace worker
```

### Adding New Commands

1. Define the command in `TaskCLI.ts`:

```typescript
program
  .command("my-command")
  .description("My custom command")
  .option("-t, --text <text>", "Input text")
  .action(async (options) => {
    // Command implementation
  });
```

2. Implement the command logic using Workglow workflows:

```typescript
const workflow = new Workflow();
workflow.MyCustomTask(options);
await workflow.run();
```

## Available Models

### HuggingFace Transformers (ONNX)

- **Text Generation**:
  - `onnx:Xenova/LaMini-Flan-T5-783M:q8`
  - `onnx:Xenova/distilgpt2:q8`

- **Translation**:
  - `onnx:Xenova/m2m100_418M:q8`
  - `onnx:Xenova/opus-mt-en-de:q8`

- **Classification**:
  - `onnx:Xenova/distilbert-base-uncased:q8`
  - `onnx:Xenova/roberta-base-sentiment:q8`

### TensorFlow MediaPipe

- **Text Embeddings**:
  - `mediapipe:universal-sentence-encoder`

## Performance

- **Model Caching**: Models are cached after first download
- **Quantized Models**: Use quantized models (q8) for better performance

## Troubleshooting

### Common Issues

1. **Model Download Failures**:

   ```bash
   # Clear model cache
   rm -rf ~/.cache/
   ```

2. **Memory Issues**:

   ```bash
   # Use smaller models or increase system memory
   workglow generate --model "onnx:Xenova/distilgpt2:q8"
   ```

## Examples

### Batch Processing

Process multiple files:

```bash
for file in *.txt; do
  workglow generate "$(cat $file)" > "${file%.txt}_generated.txt"
done
```

### Pipeline Processing

Chain multiple operations:

```bash
# Generate text, then translate it
workglow generate --text "Write about AI" | \
workglow rewrite --prompt "Rewrite this text to sound like a pirate:"
```

## License

Apache 2.0 - See [LICENSE](./LICENSE) for details.
