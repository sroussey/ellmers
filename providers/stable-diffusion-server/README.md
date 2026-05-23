# `@workglow/stable-diffusion-server`

OpenAI-compatible HTTP client for an upstream
[`stable-diffusion.cpp`](https://github.com/leejet/stable-diffusion.cpp) server.

This package **does not bundle stable-diffusion.cpp**. It speaks to a
running `sd-server` process — either one you start yourself
(`externalUrl` mode) or one acquired through an `IBackendsTransport`
(`transport` mode, used by the Workglow Builder's broker).

## Install

```bash
bun add @workglow/stable-diffusion-server
```

You also need `@workglow/ai`, `@workglow/task-graph`, `@workglow/storage`,
`@workglow/job-queue`, and `@workglow/util` (peer dependencies).

## Quickstart — `externalUrl` mode

Start `sd-server` yourself, then point the provider at it:

```bash
sd-server -m ./models/sd-1.5.gguf --port 7860 --listen
```

```ts
import { registerStableDiffusionCppInline } from "@workglow/stable-diffusion-server/ai-runtime";

await registerStableDiffusionCppInline({
  externalUrl: "http://localhost:7860",
});
```

The provider is now visible to the registry as `LOCAL_STABLE_DIFFUSION_CPP`.

## Quickstart — `transport` mode (Electron + broker)

```ts
import { registerStableDiffusionCppInline } from "@workglow/stable-diffusion-server/ai-runtime";

await registerStableDiffusionCppInline({
  transport: backendsTransport, // your IBackendsTransport implementation
  endpoint: "/txt2img",
});
```

In transport mode each model record must include
`provider_config.model_path` — the absolute path to the model file. The
broker spawns one `sd-server` per `modelPath`, shared by refcount.

## Model record shape

```ts
{
  model_id: "sd-1.5",
  provider: "LOCAL_STABLE_DIFFUSION_CPP",
  provider_config: {
    model_path: "/abs/path/to/sd-1.5.gguf",        // required for transport mode
    model_name: "sd-1.5",                           // optional; sent as OpenAI `model` field
    base_url: "http://localhost:7860",              // optional per-record override
    endpoint: "/txt2img",                           // optional per-record endpoint override
  },
  capabilities: [],
  metadata: {},
}
```

## Supported capabilities

| Capability | Endpoint | Notes |
|---|---|---|
| `image.generation` | `POST /txt2img` (or `POST /v1/images/generations`) | txt2img — endpoint flavor configurable, see below |
| `image.editing` | `POST /img2img` | img2img with base64-encoded init image |
| `model.info` | derived from acquired URL | Reports `is_loaded` based on broker handle / externalUrl |
| `model.search` | `GET /v1/models` | externalUrl mode only — see below |

### Endpoint flavor: `/txt2img` vs `/v1/images/generations`

`image.generation` supports two request shapes, selectable per record
(via `provider_config.endpoint`) or per provider (via the
`registerStableDiffusionCpp*({ endpoint })` option):

- **`/txt2img`** — the conventional stable-diffusion.cpp HTTP API.
  Defaults to this if neither model nor provider sets one.
- **`/v1/images/generations`** — used by OpenAI-compatible sd.cpp
  builds. Sends `model`, `prompt`, `n`, `size` in the OpenAI request
  shape; response is parsed as `data[].b64_json`.

`image.editing` always uses `/img2img` regardless of the txt2img
endpoint flavor.

### Why `model.search` returns `[]` in transport mode

`transport.ensureRunning` requires a `modelPath`, which is what
`model.search` is meant to help the user pick. The broker's catalog of
installed models is the Builder UI's concern, not the provider's. In
`externalUrl` mode `GET /v1/models` works and returns whatever the
server enumerates.

## Registration shapes

Three registration entry points, all sharing the same options
(`{ transport?, externalUrl?, endpoint? }`):

- **`registerStableDiffusionCppInline(options)`** — main-thread inline.
  Primarily used in tests and any single-thread scenario.
- **`registerStableDiffusionCppWorker(options)`** — called inside a
  worker runtime. This is the primary production path. The worker
  constructs its own `IBackendsTransport` (e.g.,
  `MessagePortBackendsTransport`) and passes it here directly — no port
  transfer happens.
- **`registerStableDiffusionCpp({ worker })`** — main-thread proxy that
  forwards jobs to a worker. The actual run-fns and transport live in
  the worker; this side only exposes the provider identifier to the
  registry.

## Browser

`@workglow/stable-diffusion-server/ai` resolves to a browser bundle that
uses the exact same source as the node bundle. Pure `fetch` works the
same in both. In a plain browser there is no broker to construct an
`IBackendsTransport` against, so practical use is `externalUrl` mode;
nothing in the code forbids passing a custom transport if one exists.
