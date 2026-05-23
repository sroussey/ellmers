# `@workglow/llamacpp-server`

OpenAI-compatible HTTP client for an upstream
[`llama-server`](https://github.com/ggerganov/llama.cpp/tree/master/examples/server)
instance.

This package **does not bundle llama.cpp**. It speaks to a running
`llama-server` process — either one you start yourself (`externalUrl` mode)
or one acquired through an `IBackendsTransport` (`transport` mode, used by
the Workglow Builder's broker).

## Install

```bash
bun add @workglow/llamacpp-server
```

You also need `@workglow/ai`, `@workglow/task-graph`, `@workglow/storage`,
`@workglow/job-queue`, and `@workglow/util` (peer dependencies).

## Quickstart — `externalUrl` mode

Start `llama-server` yourself, then point the provider at it:

```bash
llama-server -m ./models/llama-3-8b-q4_k_m.gguf --port 8080 --embedding
```

```ts
import { registerLlamaCppServerInline } from "@workglow/llamacpp-server/ai-runtime";

await registerLlamaCppServerInline({
  externalUrl: "http://localhost:8080",
});
```

The provider is now visible to the registry as `LOCAL_LLAMACPP_SERVER`.

## Quickstart — `transport` mode (Electron + broker)

```ts
import { registerLlamaCppServerInline } from "@workglow/llamacpp-server/ai-runtime";

await registerLlamaCppServerInline({
  transport: backendsTransport, // your IBackendsTransport implementation
  defaultCtx: 4096,
});
```

In transport mode each model record must include
`provider_config.model_path` — the absolute path to the `.gguf` file. The
broker spawns one `llama-server` per `(modelPath, ctx)` triple, shared by
refcount.

## Model record shape

```ts
{
  model_id: "llama-3-8b",
  provider: "LOCAL_LLAMACPP_SERVER",
  provider_config: {
    model_path: "/abs/path/to/llama-3-8b.gguf", // required for transport mode
    model_name: "llama-3-8b",                    // optional; sent as OpenAI `model` field
    base_url: "http://localhost:8080",           // optional per-record override
    native_dimensions: 768,                       // optional embedding-dim override
    ctx: 8192,                                    // optional ctx override
  },
  capabilities: [],
  metadata: {},
}
```

The provider's `inferCapabilities` heuristic populates the capability set
at runtime based on the file name (llava → vision, `*embed*` → embedding,
otherwise full text-gen + tool-use).

## Supported capabilities

| Capability | Endpoint | Notes |
|---|---|---|
| `text.generation` | `POST /v1/chat/completions` | Chat + prompt unified |
| `text.generation` + `tool-use` | `POST /v1/chat/completions` with `tools[]` | OpenAI tool calls |
| `text.rewriter` | `POST /v1/chat/completions` | System=prompt, user=text |
| `text.summary` | `POST /v1/chat/completions` | Fixed summary instruction |
| `text.embedding` | `POST /v1/embeddings` | Requires `--embedding` flag |
| `vision-input` | `POST /v1/chat/completions` with `image_url` parts | llava-family models |
| `model.info` | `GET /v1/models` + `GET /props` | Embedding dims via `n_embd` |
| `model.search` | `GET /v1/models` | externalUrl mode only — see below |

### Why `model.search` returns `[]` in transport mode

`transport.ensureRunning` requires a `modelPath`, which is what
`model.search` is meant to help the user pick. The broker's catalog of
installed models is the Builder UI's concern, not the provider's. In
`externalUrl` mode `GET /v1/models` works and returns the one model the
server has loaded.

## Registration shapes

Three registration entry points, all sharing the same options:

- **`registerLlamaCppServerInline({ transport?, externalUrl?, defaultCtx? })`**
  — main-thread inline. Primarily used in tests and any single-thread
  embedding scenario.
- **`registerLlamaCppServerWorker({ transport?, externalUrl?, defaultCtx? })`**
  — called inside a worker runtime. This is the primary production path.
  The worker constructs its own `IBackendsTransport` (e.g.,
  `MessagePortBackendsTransport`) and passes it here directly — no port
  transfer happens.
- **`registerLlamaCppServer({ worker })`** — main-thread proxy that
  forwards jobs to a worker. The actual run-fns and transport live in
  the worker; this side only exposes the provider identifier to the
  registry.

## Browser

`@workglow/llamacpp-server/ai` resolves to a browser bundle that uses the
exact same source as the node bundle. Pure `fetch` works the same in
both. In a plain browser there is no broker to construct an
`IBackendsTransport` against, so practical use is `externalUrl` mode;
nothing in the code forbids passing a custom transport if one exists.
