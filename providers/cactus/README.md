# @workglow/cactus

[needle-rs](https://github.com/Geekgineer/needle-rs) tool-calling provider for [@workglow/ai](https://www.npmjs.com/package/@workglow/ai).

Wraps the 413 KB needle-rs WASM runtime and Cactus Needle models. Runs in browser (Cache Storage) and Node/Bun (filesystem). Specialized tool-routing only — no free-form chat.

Catalog:

- **Needle 2** (`needle-v2`) — single 13.7 MB `.cact` image from [`Cactus-Compute/needle2`](https://huggingface.co/Cactus-Compute/needle2)
- **Needle 26M** (`needle-26m`) — INT4 SafeTensors (22 MB) from [`Abdalrahman/needle-rs-safetensors`](https://huggingface.co/Abdalrahman/needle-rs-safetensors)

## Capabilities

- `tool-use` — function/tool calling via `engine.run` / `engine.run_json` / `engine.run_stream`
- `model.search`, `model.info` — catalog of Needle 2 and Needle 26M
- `model.download`, `model.download-remove` — fetch + cache catalog assets (one `.cact` for v2; weights, vocab, and config for v1)

## Entry points

- `@workglow/cactus/ai` — main-thread shell: `registerCactus`, schema, constants, provider classes
- `@workglow/cactus/ai-runtime` — worker server and inline runtime: `registerCactusWorker`, `registerCactusInline`, runtime helpers
