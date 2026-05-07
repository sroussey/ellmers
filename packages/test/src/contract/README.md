# Contract Conformance Suites

Parameterized test suites that exercise an interface contract against
every adapter that implements it. Each suite exports one function:

    export function runXxxConformance(opts: { factory, capabilities, ... }): void;

An adapter writes a thin caller that supplies a factory and capability flags;
all behavioral assertions are inherited.

## Why a separate directory

`packages/test/src/contract/` contains only parameterized suites. Concrete
test files (`*.test.ts`) live under `packages/test/src/test/`. This boundary
makes the pattern obvious: anything in `contract/` is reusable; nothing here
runs on its own.

Two pre-existing parameterized suites live with their concrete callers and
stay in place — moving them is unnecessary churn:

- `packages/test/src/test/job-queue/genericJobQueueTests.ts`
- `packages/test/src/test/storage-tabular/genericTabularStorageTests.ts`

Treat both as additional examples of the pattern.

## Conventions

1. **Entrypoint shape.**

       export function runXxxConformance(opts: {
         readonly name: string;
         readonly skip?: boolean;
         readonly timeout: number;
         readonly factory: () => Promise<{ register, dispose, inspect }>;
         readonly capabilities: Record<string, boolean>;
         // ...contract-specific fields
       }): void;

   Defines a single top-level `describe.skipIf(opts.skip)`.

2. **Factory shape.** `factory()` returns a fresh handle per top-level
   `beforeAll`. The handle exposes:
   - `register()` — install the provider/storage/queue and any model records.
   - `dispose()` — release resources; called in `afterAll`.
   - `inspect()` — optional whitebox handle for assertions that need to
     observe internal state (session maps, disposable refs). Adapters that
     don't expose internals return `{}`; assertions skip with a logged
     warning instead of passing silently.

3. **Capability flags drive `describe.skipIf(!cap)` blocks.** Never silently
   skip on missing capability without a flag — the absence of a flag
   indicates a contract gap, not a permitted variation.

4. **Live-API tests honor existing preload + retry/timeout settings.** Do
   not introduce new env vars from a contract suite.

5. **Adapter shims are short.** A new adapter joining a contract suite
   should be ~30 lines: imports, factory, capability flags, model IDs.

6. **`dispose()` must be idempotent.** Conformance suites may call dispose
   multiple times (once for the dispose assertion, once in `afterAll`).
   Adapters whose underlying resource doesn't natively support repeated
   dispose should guard with a flag.

### Factory shape variants

The `register/dispose/inspect` factory documented above is one of two
legitimate shapes — used when an adapter is a long-lived global registration
(e.g. an AI provider). For contracts whose subject is heavyweight but
per-test state (e.g. browser contexts), prefer a `create/dispose` factory
where each top-level block instantiates its own subject:

    factory: () => Promise<{
      create: () => Promise<TSubject>;
      dispose: (subject: TSubject) => Promise<void>;
    }>

The principle is the same: a fresh handle per block, with no shared state
that block N can leak into block N+1. The methods on the handle are
contract-specific.

## Available suites

| Contract | Suite | Adapters |
|---|---|---|
| `AiProvider` | `contract/ai-provider/runAiProviderConformance` | Anthropic, OpenAI, Gemini, Ollama, HF Inference, HF Transformers, LlamaCpp |
| `IQueueStorage` + `IRateLimiterStorage` | `test/job-queue/genericJobQueueTests` | InMemory, IndexedDB, Postgres, SQLite, Supabase |
| `ITabularStorage` | `test/storage-tabular/genericTabularStorageTests` | InMemory, IndexedDB, Postgres, SQLite, Supabase, FsFolder, HuggingFace |
| `IEntitlementProfile` | `contract/entitlement-profile/runEntitlementProfileConformance` | Browser, Desktop, Server, Custom |
| `IBrowserContext` | `contract/browser-context/runIBrowserContextConformance` | Mock, Playwright, BunWebView, Electron |

## How to add a new contract suite

1. Pick a contract surface (an interface or abstract base class).
2. Enumerate the behavioral invariants the contract implies but that aren't
   currently asserted in any concrete test.
3. Decide the capability matrix — which assertions are universal, which
   are opt-in.
4. Create `packages/test/src/contract/<contract-name>/` with `types.ts`,
   `fixtures.ts`, `run<Contract>Conformance.ts`, and per-assertion files
   under `assertions/`.
5. Write one shim caller per adapter under
   `packages/test/src/test/<contract-name>/<Adapter>_Generic.integration.test.ts`.
6. Add a row to the table above.

## Roadmap

Future contract suites in priority order:

1. Storage extensions (subscribeToChanges ordering, vector-dimension format,
   putBulk round-trip count, deleteSearch streaming) — additions to the
   existing `genericTabularStorageTests.ts`.
2. Worker-proxy contract — every provider in worker mode round-trips
   identical assertions to direct mode.
3. `IBrowserContext` — Playwright / Electron / BunWebView / CDP backends.
4. `IHumanConnector` — App + Electron elicitation backends.
