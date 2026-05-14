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
