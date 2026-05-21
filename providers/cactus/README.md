# @workglow/cactus

[needle-rs](https://github.com/Geekgineer/needle-rs) tool-calling provider for [@workglow/ai](https://www.npmjs.com/package/@workglow/ai).

Wraps the 258 KB needle-rs WASM runtime and the 22 MB INT4 SafeTensors **Needle 26M** model from [`Abdalrahman/needle-rs-safetensors`](https://huggingface.co/Abdalrahman/needle-rs-safetensors). Runs in browser (Cache Storage) and Node/Bun (filesystem). Specialized tool-routing only — no free-form chat.

## Capabilities

- `tool-use` — function/tool calling via `engine.run` / `engine.run_stream`
- `model.search`, `model.info` — single-model catalog (Needle 26M)
- `model.download`, `model.download-remove` — fetch + cache the three model files

## Entry points

- `@workglow/cactus/ai` — main-thread shell: `registerCactus`, schema, constants, provider classes
- `@workglow/cactus/ai-runtime` — worker server and inline runtime: `registerCactusWorker`, `registerCactusInline`, runtime helpers
