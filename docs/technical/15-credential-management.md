<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Credential Management

## Overview

Workglow provides a layered credential management system for storing and resolving
sensitive values -- API keys, tokens, and passwords -- required by AI providers and
other external services. The system is designed around three principles: **pluggable
backends** (swap between in-memory, environment variable, or encrypted storage without
changing task code), **automatic resolution** (credentials are looked up transparently
during the input resolution phase before a task executes), and **worker isolation**
(credentials are resolved on the main thread and passed as plain values into worker
contexts, so workers never need access to credential stores or key material).

The credential subsystem spans several packages:

| File | Purpose |
|------|---------|
| `packages/util/src/credentials/ICredentialStore.ts` | `ICredentialStore` interface and `CREDENTIAL_STORE` service token |
| `packages/util/src/credentials/InMemoryCredentialStore.ts` | Non-persistent in-memory store for development |
| `packages/util/src/credentials/EnvCredentialStore.ts` | Read credentials from environment variables |
| `packages/util/src/credentials/ChainedCredentialStore.ts` | Layered resolution across multiple stores |
| `packages/util/src/credentials/CredentialStoreRegistry.ts` | Global store registration, `resolveCredential()`, and input resolver registration |
| `packages/util/src/credentials/OtpPassphraseCache.ts` | XOR-masked passphrase cache with TTL |
| `packages/util/src/credentials/CredentialProviderOptions.ts` | Provider enum values for metadata |
| `packages/util/src/credentials/CredentialPutInputSchema.ts` | JSON Schema for credential storage forms |
| `packages/util/src/crypto/WebCrypto.ts` | AES-256-GCM encryption/decryption via Web Crypto API |
| `packages/storage/src/credentials/EncryptedKvCredentialStore.ts` | Encrypted-at-rest store backed by any `IKvStorage` |
| `packages/storage/src/credentials/LazyEncryptedCredentialStore.ts` | Lock/unlock wrapper for `EncryptedKvCredentialStore` |

---

## Credential Resolution Strategy

When an AI provider needs an API key, the resolution follows a strict three-tier
fallback chain: **credential_key** (looked up from the credential store), then
**api_key** (inline literal), then **environment variable** (provider-specific).
Every provider's `getClient()` function implements this pattern identically:

```typescript
const apiKey =
  config?.credential_key ||  // 1. Resolved from credential store
  config?.api_key ||         // 2. Inline API key in provider_config
  process.env?.ANTHROPIC_API_KEY;  // 3. Environment variable fallback
```

The `credential_key` field in `provider_config` is annotated with
`format: "credential"` in the model schema. During the `resolveSchemaInputs()`
phase of task execution, the `TaskRunner` walks the input schema, finds properties
with this format annotation, and invokes the registered `"credential"` input
resolver. That resolver calls `resolveCredential(id, registry)` which queries the
credential store for the key and returns the actual secret value. By the time the
provider's `getClient()` function runs, `credential_key` already contains the
resolved API key string -- not the store lookup key.

The full resolution sequence during task execution:

```
1. User configures model:
   { provider_config: { credential_key: "my-anthropic-key", model_name: "claude-sonnet-4-20250514" } }

2. TaskRunner calls resolveSchemaInputs() before execute():
   - Walks input schema, finds credential_key with format: "credential"
   - Calls registered "credential" resolver
   - Resolver calls resolveCredential("my-anthropic-key", registry)
   - Credential store returns "sk-ant-..." (the actual API key)
   - credential_key is now "sk-ant-..."

3. Provider getClient() receives the resolved config:
   config.credential_key === "sk-ant-..."  // Already the real API key
```

If the credential store does not contain the requested key, the resolver returns
`undefined` — **never the reference string**. Echoing the id back would thread the
credential's *name* through as its *value*, so a missing key would end up sent as a
real secret (for example straight into an `Authorization: Bearer <key-name>` header),
leaking the key name to the remote host and masking the misconfiguration. Consumers
treat `undefined` as "no credential" and fall through to the `api_key` or environment
variable checks, or raise their own missing-key error.

---

## ICredentialStore Interface

All credential stores implement the `ICredentialStore` interface, which provides a
minimal key-value API for secret management:

```typescript
interface ICredentialStore {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string, options?: CredentialPutOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  keys(): Promise<readonly string[]>;
  deleteAll(): Promise<void>;
}
```

The `keys()` method returns only key names, never values. The `get()` method returns
`undefined` both when a key does not exist and when it has expired. Implementations
must not log or expose credential values in error messages.

Each credential can carry optional metadata via `CredentialPutOptions`:

```typescript
interface CredentialPutOptions {
  readonly label?: string;      // Human-readable label
  readonly provider?: string;   // Associated provider name (e.g., "anthropic")
  readonly expiresAt?: Date;    // Expiration date (undefined = never)
}
```

The global credential store is registered through the dependency injection system
under the `CREDENTIAL_STORE` service token:

```typescript
import { CREDENTIAL_STORE, setGlobalCredentialStore } from "@workglow/util";

setGlobalCredentialStore(myStore);

// Or register directly in a ServiceRegistry
registry.registerInstance(CREDENTIAL_STORE, myStore);
```

---

## Credential Store Implementations

### InMemoryCredentialStore

A plain `Map`-backed store for development and testing. Credentials are stored in
memory and lost when the process exits. It respects expiration dates -- expired
entries are cleaned up lazily on `get()`, `has()`, and `keys()` calls.

```typescript
import { InMemoryCredentialStore } from "@workglow/util";

const store = new InMemoryCredentialStore();
await store.put("openai-api-key", "sk-...", { provider: "openai" });
const key = await store.get("openai-api-key"); // "sk-..."
```

### EnvCredentialStore

Reads credentials from environment variables using either explicit key-to-variable
mappings or a prefix-based naming convention. When no explicit mapping exists for a
key, the store converts the key to uppercase, replaces hyphens with underscores, and
optionally prepends a prefix.

```typescript
import { EnvCredentialStore } from "@workglow/util";

// Explicit mapping
const store = new EnvCredentialStore({
  "anthropic-api-key": "ANTHROPIC_API_KEY",
  "openai-api-key": "OPENAI_API_KEY",
});
const key = await store.get("anthropic-api-key"); // reads process.env.ANTHROPIC_API_KEY

// Prefix convention
const prefixed = new EnvCredentialStore({}, "WORKGLOW");
// "my-api-key" resolves to process.env.WORKGLOW_MY_API_KEY
```

The `put()` method sets the environment variable for the current process lifetime.
The environment variable check uses `typeof process !== "undefined"` to avoid
crashing in browser environments where `process` is not available.

### EncryptedKvCredentialStore

Encrypts credential values with AES-256-GCM before persisting them to any
`IKvStorage` backend (SQLite, PostgreSQL, IndexedDB, in-memory). This is the
recommended store for production deployments. Encryption uses the Web Crypto API,
available in Node 20+, Bun, and all modern browsers.

```typescript
import { EncryptedKvCredentialStore } from "@workglow/storage";
import { SqliteKvStorage } from "@workglow/storage";

const kv = new SqliteKvStorage(":memory:");
const store = new EncryptedKvCredentialStore(kv, "my-encryption-passphrase");

await store.put("openai-api-key", "sk-...", { provider: "openai" });
const key = await store.get("openai-api-key"); // "sk-..."
```

Each stored credential record contains: the encrypted ciphertext (base64), the
initialization vector (base64), and plaintext metadata (label, provider, timestamps,
expiration). The passphrase is never stored -- it must be provided at construction
time.

### LazyEncryptedCredentialStore

A lock/unlock wrapper around `EncryptedKvCredentialStore`. The store starts in a
locked state where reads silently return `undefined` and writes throw. This is useful
in applications where the user provides a passphrase after startup:

```typescript
import { LazyEncryptedCredentialStore } from "@workglow/storage";

const lazy = new LazyEncryptedCredentialStore(kvStorage);
await lazy.get("key"); // undefined (locked)

await lazy.unlock("user-passphrase");
await lazy.get("key"); // decrypted value

lazy.lock(); // discards inner store and derived key cache
```

### ChainedCredentialStore

Combines multiple stores into a single `ICredentialStore` with cascading lookup.
Reads try each store in order, returning the first match. Writes always go to the
first (primary) store. This enables layered resolution patterns:

```typescript
import {
  ChainedCredentialStore,
  InMemoryCredentialStore,
  EnvCredentialStore,
} from "@workglow/util";
import { EncryptedKvCredentialStore } from "@workglow/storage";

const store = new ChainedCredentialStore([
  new InMemoryCredentialStore(),                        // Runtime overrides
  new EncryptedKvCredentialStore(kv, passphrase),       // Persistent encrypted
  new EnvCredentialStore({ "openai": "OPENAI_API_KEY" }), // Environment fallback
]);
```

---

## Provider Config Fields

Every model configuration includes a `provider_config` object. The base
`ModelConfigSchema` declares the common `credential_key` field, while each provider
extends it with provider-specific fields:

| Field | Type | Description |
|-------|------|-------------|
| `credential_key` | `string` | Key to look up in the credential store. Annotated with `format: "credential"` for automatic resolution. |
| `api_key` | `string` | Inline API key (fallback when credential_key is absent). Not part of the persisted schema -- used only in `getClient()` resolution. |
| `base_url` | `string` | Override the provider's default API endpoint. Useful for proxies, Azure OpenAI, or self-hosted instances. |
| `model_name` | `string` | The provider-specific model identifier (e.g., `"claude-sonnet-4-20250514"`, `"gpt-4o"`). |
| `max_tokens` | `integer` | Default max tokens for responses (Anthropic-specific). |
| `organization` | `string` | Organization ID (OpenAI-specific). |

The `credential_key` field is marked with `"x-ui-hidden": true` in provider schemas,
keeping it out of end-user form UIs while still participating in the automatic
resolution system.

---

## Credentials in FetchUrlTask

`FetchUrlTask` consumes credentials through the same `format: "credential"` path: its
`credential_key` input is resolved to the real secret before `execute()` runs. Two
sibling ports — plain, non-secret configuration — decide where that secret goes:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `credential_key` | `string` (`format: "credential"`) | -- | Key to look up in the credential store. |
| `credential_scheme` | `"bearer" \| "basic" \| "header" \| "none"` | `"bearer"` | How the resolved secret is placed on the request. |
| `credential_header` | `string` | `"Authorization"` | Header name used when `credential_scheme` is `"header"`. |

- **`bearer`** -- `Authorization: Bearer <secret>`. The default, so existing graphs
  are unaffected.
- **`basic`** -- `Authorization: Basic <secret>`. The secret is used **verbatim** and
  must already be the base64 encoding of `user:pass`; the task performs no splitting
  or encoding of its own.
- **`header`** -- the raw secret becomes the value of `credential_header`, for
  API-key style services (e.g. `X-Api-Key`).
- **`none`** -- the credential is resolved but never placed on the request.

`credential_header` must be 1-64 characters of letters, digits, or hyphens; anything
else raises a `TaskConfigurationError`. The narrow allow-list rejects the CR/LF, colon
and whitespace characters that would otherwise let a configured header name inject
additional headers into the outbound request. Validation runs even for schemes that
ignore the field, so a malformed name is reported rather than silently discarded.

The placement logic is the exported pure function `applyCredentialToHeaders()`
(`packages/tasks/src/task/FetchUrlCredentials.ts`), so it can be exercised directly.

### Credentials and the queued path

`FetchUrlTask` can dispatch through a job queue (`config.queue`) to get per-domain
rate limiting. **A credential cannot be combined with that path.** Queue payloads are
persisted durably (SQLite / Postgres / SQS), so a resolved secret written into the
queued job input would be written to storage. Setting both raises a
`TaskConfigurationError`:

```ts
// Throws: credential_key cannot be combined with config.queue
new FetchUrlTask({ queue: "fetch:api.example.com" })
  .run({ url: "https://api.example.com/data", credential_key: "my-api-key" });
```

The refusal is deliberate and explicit rather than a silent downgrade to the inline
path, which would quietly drop the rate limiting the caller asked for. To use both,
have the queue worker supply the credential itself instead of threading it through
the job payload.

The invariant holds regardless of scheme: `credential_key`, `credential_scheme`, and
`credential_header` are all stripped from the job input, so the resolved secret only
ever exists as an in-process request header. Note that a resolved credential
**overwrites** a same-named header the caller supplied in `headers` -- the credential
store is authoritative, and letting a hard-coded header shadow it would silently
defeat the configured credential.

---

## Provider-Specific Patterns

Each provider's `getClient()` function follows the same resolution pattern but checks
different environment variables as the final fallback:

| Provider | Environment Variable(s) | Client Constructor |
|----------|------------------------|--------------------|
| Anthropic | `ANTHROPIC_API_KEY` | `new Anthropic({ apiKey, baseURL })` |
| OpenAI | `OPENAI_API_KEY` | `new OpenAI({ apiKey, baseURL, organization })` |
| Google Gemini | `GOOGLE_API_KEY`, `GEMINI_API_KEY` | `new GoogleGenerativeAI(apiKey)` |
| Hugging Face | `HF_TOKEN` | `new InferenceClient(apiKey)` |
| Ollama | (none -- local service) | `new Ollama({ host })` |

Ollama is the exception: it does not require an API key because it runs as a local
service. Its `getClient()` only reads `base_url` from `provider_config`, defaulting
to `http://localhost:11434`.

Providers that support browser usage (Anthropic, OpenAI) pass
`dangerouslyAllowBrowser: true` when they detect a browser or web worker context via
`typeof globalThis.document !== "undefined" || "WorkerGlobalScope" in globalThis`.

---

## Worker Isolation

Workers run in an isolated runtime with a separate `globalServiceRegistry`. They do
not have access to the main thread's credential store, model repository, or other
registered services. This is a deliberate security boundary: credentials are resolved
on the main thread and passed into workers as plain string values through the
serialized job input.

The flow works as follows:

1. The `TaskRunner` on the main thread calls `resolveSchemaInputs()`, which resolves
   `credential_key` values from the credential store into actual API key strings.
2. The resolved `ModelConfig` (now containing the real API key in `credential_key`)
   is passed as part of the `AiJobInput` to the worker via structured cloning.
3. Inside the worker, the provider's `getClient()` reads `config.credential_key`
   directly -- it receives the already-resolved API key, not a store lookup key.

This design means:

- **Workers never access credential stores.** They receive only the specific
  credential values they need for a single execution.
- **Passphrase material stays on the main thread.** The encryption passphrase for
  `EncryptedKvCredentialStore` never crosses the worker boundary.
- **The blast radius is minimized.** A compromised worker can only see the
  credentials passed to it for the current job, not the entire credential store.

---

## Security Model

### Encryption at Rest

`EncryptedKvCredentialStore` encrypts each credential value with AES-256-GCM using
the Web Crypto API. Key derivation uses PBKDF2 with 600,000 iterations and SHA-256,
following current OWASP recommendations. Each encryption operation generates a random
16-byte salt and 12-byte IV. The salt is prepended to the ciphertext so that
decryption can reconstruct the derived key. Derived `CryptoKey` objects are cached
per-salt in memory to avoid redundant PBKDF2 work.

Metadata (label, provider, timestamps) is stored in plaintext alongside the encrypted
value, since it contains no secret material.

### Passphrase Caching with OtpPassphraseCache

For applications that prompt the user for a passphrase, `OtpPassphraseCache` provides
a time-limited in-memory cache that avoids storing the plaintext passphrase directly.
It XOR-masks the passphrase with a random one-time pad and stores only the masked
value and the pad as `Uint8Array` instances. The plaintext is reconstructed on each
`retrieve()` call by XOR-ing the two arrays back together.

```typescript
import { OtpPassphraseCache } from "@workglow/util";

const cache = new OtpPassphraseCache({
  hardTtlMs: 6 * 60 * 60 * 1000, // 6 hours absolute expiry
  idleTtlMs: 30 * 60 * 1000,     // 30 minutes idle expiry
  onExpiry: () => lazyStore.lock(),
});

cache.store("user-entered-passphrase");
const passphrase = cache.retrieve(); // Reconstructs plaintext
cache.clear(); // Zeroes both buffers
```

The cache supports two TTL modes: a hard TTL (unconditional expiry) and an idle TTL
(resets on each `retrieve()` call). When either fires, both buffers are zeroed and
the `onExpiry` callback is invoked -- typically used to lock a
`LazyEncryptedCredentialStore`.

### Minimal Exposure Principles

- **Never log credential values.** The `ICredentialStore` contract explicitly
  prohibits implementations from including secret values in error messages.
- **`keys()` never returns values.** Only key names are listed, never the secrets
  themselves.
- **Scoped resolution.** `resolveCredential()` accepts an optional `ServiceRegistry`
  parameter, allowing different parts of an application to use different credential
  stores. A registry-scoped store takes precedence over the global store.
- **Expired credentials are garbage-collected.** All store implementations check
  `expiresAt` on reads and silently remove expired entries.

---

## Platform Differences

### Server (Node.js / Bun)

- `EnvCredentialStore` reads `process.env` directly.
- `EncryptedKvCredentialStore` typically uses `SqliteKvStorage` or
  `PostgresKvStorage` as its backend.
- `OtpPassphraseCache` timers are `.unref()`-ed so they do not keep the process
  alive.

### Browser

- `EnvCredentialStore` returns `undefined` for all lookups (no `process.env`).
  Browser applications should use `InMemoryCredentialStore` or
  `EncryptedKvCredentialStore` backed by `IndexedDbKvStorage`.
- The Web Crypto API (`crypto.subtle`) is available natively -- no polyfills needed.
- Provider clients (Anthropic, OpenAI) set `dangerouslyAllowBrowser: true`
  when they detect a browser or web worker context (see
  `providers/anthropic/src/ai/common/Anthropic_Client.ts`
  and `providers/openai/src/ai/common/OpenAI_Client.ts`).
  This is **not** automatically safe: any API key loaded into a browser
  context — even one decrypted from `EncryptedKvCredentialStore` at runtime —
  is reachable from the page and should be treated as exposed to the end user.
  Use browser-side provider calls only with short-lived, user-scoped keys, a
  proxy that injects credentials server-side, or local providers (Ollama,
  Transformers.js, MediaPipe) that do not require a secret at all.
- Web Workers receive credentials via structured cloning, same as Node/Bun workers.

---

## Configuration Reference

### Setting Up a Production Credential Store

```typescript
import { ChainedCredentialStore, InMemoryCredentialStore, EnvCredentialStore,
         setGlobalCredentialStore } from "@workglow/util";
import { EncryptedKvCredentialStore, SqliteKvStorage } from "@workglow/storage";

// 1. Create the encrypted backend
const kv = new SqliteKvStorage("credentials.db");
const passphrase = process.env.CREDENTIAL_PASSPHRASE;
if (!passphrase) {
  throw new Error("CREDENTIAL_PASSPHRASE environment variable is required");
}
const encrypted = new EncryptedKvCredentialStore(kv, passphrase);

// 2. Chain with environment fallback
const store = new ChainedCredentialStore([
  encrypted,
  new EnvCredentialStore({
    "anthropic-api-key": "ANTHROPIC_API_KEY",
    "openai-api-key": "OPENAI_API_KEY",
    "google-api-key": "GOOGLE_API_KEY",
    "hf-token": "HF_TOKEN",
  }),
]);

// 3. Register globally
setGlobalCredentialStore(store);
```

### Configuring a Model with Credential Key

```typescript
import { ModelRepository } from "@workglow/ai";

const repo = new ModelRepository(storage);
await repo.upsert({
  model_id: "claude-sonnet",
  title: "Claude Sonnet",
  description: "Anthropic Claude Sonnet model",
  provider: "anthropic",
  tasks: ["TextGenerationTask", "TextSummaryTask"],
  provider_config: {
    model_name: "claude-sonnet-4-20250514",
    credential_key: "anthropic-api-key",  // Resolved from credential store at runtime
    max_tokens: 4096,
  },
  metadata: {},
});
```

### Using Scoped Credential Stores

```typescript
import { ServiceRegistry, CREDENTIAL_STORE, InMemoryCredentialStore } from "@workglow/util";

// Create a scoped registry with its own credential store
const registry = new ServiceRegistry();
const scopedStore = new InMemoryCredentialStore();
await scopedStore.put("api-key", "sk-scoped-...");
registry.registerInstance(CREDENTIAL_STORE, scopedStore);

// resolveCredential checks the registry first, then falls back to global
import { resolveCredential } from "@workglow/util";
const key = await resolveCredential("api-key", registry); // "sk-scoped-..."
```

---

## API Reference

### Core Functions

| Function | Package | Description |
|----------|---------|-------------|
| `getGlobalCredentialStore()` | `@workglow/util` | Returns the current global `ICredentialStore` instance. |
| `setGlobalCredentialStore(store)` | `@workglow/util` | Replaces the global credential store. |
| `resolveCredential(key, registry?)` | `@workglow/util` | Resolves a credential by key, checking the registry-scoped store first, then the global store. |

### Store Classes

| Class | Package | Description |
|-------|---------|-------------|
| `InMemoryCredentialStore` | `@workglow/util` | `Map`-backed store for development. |
| `EnvCredentialStore` | `@workglow/util` | Environment variable-backed store with explicit or prefix-based key mapping. |
| `ChainedCredentialStore` | `@workglow/util` | Cascading lookup across multiple stores; writes to the first. |
| `EncryptedKvCredentialStore` | `@workglow/storage` | AES-256-GCM encrypted store backed by any `IKvStorage`. |
| `LazyEncryptedCredentialStore` | `@workglow/storage` | Lock/unlock wrapper that defers passphrase until needed. |

### Security Utilities

| Class / Function | Package | Description |
|-----------------|---------|-------------|
| `OtpPassphraseCache` | `@workglow/util` | XOR-masked passphrase cache with hard and idle TTLs. |
| `encrypt(plaintext, passphrase, keyCache)` | `@workglow/util` | AES-256-GCM encryption returning `{ encrypted, iv }`. |
| `decrypt(encrypted, iv, passphrase, keyCache)` | `@workglow/util` | AES-256-GCM decryption returning plaintext. |
| `deriveKey(passphrase, salt)` | `@workglow/util` | PBKDF2 key derivation (600,000 iterations, SHA-256). |

### Service Tokens

| Token | Type | Description |
|-------|------|-------------|
| `CREDENTIAL_STORE` | `ServiceToken<ICredentialStore>` | DI token for the credential store. Registered with a default `InMemoryCredentialStore` factory. |
