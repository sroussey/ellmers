# Workglow Web Example

A visual task graph editor and runner for Workglow AI pipelines.

## Overview

This super simple web application provides a visual interface for creating, editing, and running Workglow AI task graphs. It features real-time execution monitoring, and an integrated console for debugging and interaction.

## Features

- **Real-time Execution**: Watch tasks execute in real-time with visual feedback
- **JSON Editor**: Edit task graphs directly as JSON with syntax highlighting
- **Console Integration**: Interactive console for debugging and manual task execution
- **Multi-Provider Support**: Works with HuggingFace Transformers and TensorFlow MediaPipe
- **Local AI Models**: Run AI models entirely in the browser using WebAssembly and WebGPU
- **Persistent Storage**: Save and load task graphs using IndexedDB

## Getting Started

### Prerequisites

- Node.js 18+ or Bun
- Modern web browser with WebAssembly support

### Installation

```bash
bun install @workglow/web
```

### Development

```bash
# Start the development server
bun run dev
# or
npm run dev
```

The application will be available at `http://localhost:5173`

### Bundle analysis

Production treemap (gzip/brotli sizes) for planning chunk reductions:

```bash
bun run analyze
```

Then open `dist/stats.html` in a browser (the `dist/` folder is gitignored). Set `ANALYZE=1` is only used by this script; ordinary `bun run build-code` does not run the analyzer.

## Usage

### Creating a Task Graph

1. **Visual Editor**: Use the graph editor to drag and connect task nodes
2. **JSON Editor**: Write task graphs directly in JSON format
3. **Console**: Create workflows programmatically using the console

### Example Workflow

```javascript
// In the browser console
const workflow = new Workflow();

workflow
  .ModelDownload({
    model: [
      {
        provider: "HF_TRANSFORMERS_ONNX",
        provider_config: {
          pipeline: "text2text-generation",
          model_path: "Xenova/LaMini-Flan-T5-783M",
          dtype: "q8",
        },
      },
    ],
  })
  .TextRewriter({
    text: "The quick brown fox jumps over the lazy dog.",
    prompt: "Rewrite this text to sound like a pirate:",
  })
  .DebugLog({ log_level: "info" });

// Run the workflow
await workflow.run();
```

### Available AI Models

The application comes pre-configured with several AI models:

#### HuggingFace Transformers (ONNX)

- **LaMini-Flan-T5-783M**: Text generation and rewriting
- **m2m100_418M**: Multilingual translation
- **distilbert-base-uncased**: Text classification
- **all-MiniLM-L6-v2**: Text embeddings

#### TensorFlow MediaPipe

- **Universal Sentence Encoder**: Text embeddings
- **Text Classification**: Sentiment analysis and categorization

### Task Types

The web example supports various AI task types:

- **Text Generation**: Generate text based on prompts
- **Text Rewriting**: Rewrite text with specific instructions
- **Text Translation**: Translate text between languages
- **Text Classification**: Classify text into categories
- **Text Embeddings**: Generate vector embeddings for text
- **Debug Logging**: Log intermediate results for debugging

## Architecture

### Components

- **App.tsx**: Main application component and workflow management
- **RunGraphFlow.tsx**: Visual graph editor using React Flow
- **JsonEditor.tsx**: JSON editor with syntax highlighting
- **ConsoleFormatters.tsx**: Console output formatting and display (from debug)
- **Status Components**: Real-time status monitoring for queues and storage

### AI Integration

The application uses web workers for AI processing to keep the UI responsive:

- **worker_hft.ts**: HuggingFace Transformers worker
- **worker_tfmp.ts**: TensorFlow MediaPipe worker (text + vision tasks; MediaPipe loads on demand per task)

### Storage

- **IndexedDB**: Persistent storage for task graphs and outputs
- **In-Memory**: Temporary storage for queue management

## Development

### Project Structure

```
src/
├── App.tsx                 # Main application
├── main.tsx               # Application entry point
├── components/            # Reusable UI components
├── editor/                # JSON editor components
├── graph/                 # Graph editor components
├── status/                # Status monitoring components
├── worker_hft.ts          # HuggingFace worker
├── worker_tfmp.ts         # MediaPipe unified worker
└── main.css              # Global styles
```

### Technologies Used

- **React 19**: UI framework
- **TypeScript**: Type safety
- **Vite**: Build tool and dev server
- **React Flow**: Graph visualization
- **CodeMirror**: Code editor
- **Tailwind CSS**: Styling
- **Radix UI**: UI components

## Performance Considerations

- **Web Workers**: AI processing runs in background threads
- **Model Caching**: Models are cached after first load
- **Lazy Loading**: Models are loaded on-demand

## Browser Compatibility

- **Chrome/Edge**: Full support with WebGPU
- **Firefox**: Full support with WebGPU
- **Safari**: Limited to WebAssembly

## Troubleshooting

### Common Issues

1. **Models not loading**: Check browser console for WebAssembly errors
2. **Performance issues**: Reduce model size or use quantized models
3. **Memory errors**: Close other tabs or use smaller models

## License

Apache 2.0 - See [LICENSE](./LICENSE) for details.
