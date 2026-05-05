# Tabular Storage Contract Conformance Suite — Design

**Date:** 2026-05-04
**Status:** Draft (awaiting user review)
**Branch:** TBD (next branch off main after AiProvider PR #461 lands)
**Predecessor:** `docs/superpowers/specs/2026-05-04-aiprovider-contract-conformance-design.md`

## Summary

Add two contract invariants to a new
`packages/test/src/contract/storage-tabular/` directory mirroring the
AiProvider conformance pattern. The two invariants address half of the
"non-obvious tabular invariants" called out in the original review brief:

1. `subscribeToChanges` fires exactly once per write in commit order.
2. Vector columns reflect the schema's `TypedArray:N` format suffix.

All seven existing storage-tabular adapter test files wire to the new
contract suite as a *second* call alongside the legacy
`runGenericTabularStorageTests(...)`. Postgres and SQLite mark the
subscription assertions as `expectedFailures` because their
`subscribeToChanges` is not yet implemented; that implementation is
tracked as a follow-up feature spec. Postgres's broken
`getVectorDimensions` (currently returns `undefined`) is fixed in this
spec's final phase, mirroring the AiProvider precedent.

The other two invariants from the brief — `putBulk(N)` round-trip count
and `deleteSearch` streaming — are deferred to a follow-up spec that
designs a query-instrumentation API.

## Motivation

Workglow has a 2,039-line `genericTabularStorageTests.ts` that 7
adapters consume. It exercises the happy paths comprehensively but does
not assert the four invariants that the original PR review flagged as
silent-failure modes:

- The `subscribeToChanges` callback should fire exactly once per write,
  in commit order. Today's existing test only checks that it fires;
  duplicate or reordered fires would pass silently.
- Vector columns declared with `format: "TypedArray:Float32:384"` should
  produce real `vector(384)` columns in Postgres. Today
  `getVectorDimensions` returns `undefined` and Postgres silently
  degrades vector storage to `TEXT`.

This spec lands the two invariants that don't require building a new
instrumentation surface. It establishes the second contract suite under
the `packages/test/src/contract/` foundations laid down by the
AiProvider spec — the conventions doc, the per-assertion-module file
shape, and the `expectedFailures` opt-in pattern.

## Goals

- New `packages/test/src/contract/storage-tabular/` directory exposing
  `runTabularStorageContractTests(opts)` parameterized by factory and
  capability flags.
- All 7 adapter test files (`InMemoryTabularStorage`,
  `IndexedDbTabularStorage`, `FsFolderTabularStorage`,
  `CachedTabularStorage`, `PostgresTabularStorage`,
  `SqliteTabularStorage`, `SupabaseTabularStorage`,
  `HuggingFaceTabularStorage`) wire to the new contract suite.
- Postgres `getVectorDimensions` returns the dimension parsed from the
  `TypedArray:<element>:<N>` format suffix, so vector schemas land as
  `vector(N)` columns instead of `TEXT`.
- The shared bun/vitest `itExpectFail` polyfill moves up one level
  (`packages/test/src/contract/itExpectFail.ts`) so multiple contract
  suites can share it.

## Non-goals

- Invariant #3 (`putBulk(N)` issues O(1) round-trips) — needs a query
  instrumentation API; deferred to a follow-up design.
- Invariant #4 (`deleteSearch` streams rather than load-all) — same.
- Real `subscribeToChanges` implementation for Postgres
  (LISTEN/NOTIFY) or SQLite (polling fallback or `update_hook`) — these
  are features, not fixes; tracked as a follow-up feature spec. This
  spec only marks them as `expectedFailures`.
- Migrating the legacy 2,039-line `genericTabularStorageTests.ts` into
  `packages/test/src/contract/storage-tabular/` — out of scope; happens
  in a later spec when the dual-file setup becomes friction.
- The other four contract suites from the AiProvider roadmap
  (Worker-proxy, IBrowserContext, EntitlementProfile, IHumanConnector).

## Architecture

### File layout

```
packages/test/src/contract/
  itExpectFail.ts                              # MOVED from ai-provider/assertions/
  README.md                                    # foundations doc — add a row to suites table
  ai-provider/                                 # existing
    ...                                        # imports updated for new itExpectFail path
  storage-tabular/
    types.ts                                   # opts, handle, fixture
    fixtures.ts                                # VectorSchema, default dimension, default bulk size
    runTabularStorageContractTests.ts          # entrypoint
    assertions/
      subscribeFireOnce.ts
      subscribeCommitOrder.ts
      vectorDimensionRoundTrip.ts
```

The existing `genericTabularStorageTests.ts` and
`genericTabularStorageSubscriptionTests.ts` stay in
`packages/test/src/test/storage-tabular/` unchanged. The contract suite
is a *second* call from each adapter test file, not a replacement.

### `runTabularStorageContractTests` API

```ts
import type {
  CompoundPrimaryKeyNames,
  CompoundSchema,
} from "../../test/storage-tabular/genericTabularStorageTests";
import type {
  VectorPrimaryKeyNames,
  VectorSchema,
} from "./fixtures";

export interface TabularStorageContractOpts {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout: number;
  readonly factory: () => Promise<TabularContractHandle>;
  readonly capabilities: {
    readonly subscriptions: boolean;
    readonly vectorColumns: boolean;
  };
  readonly subscriptions?: {
    readonly usesPolling?: boolean;
    readonly pollingIntervalMs?: number;
  };
  /**
   * Names of contract assertions currently broken in this adapter.
   * Each named test is wrapped with itExpectFail.
   *
   * Known names:
   *   "subscribe.fireOncePerWrite"
   *   "subscribe.commitOrder"
   *   "vector.dimensionRoundTrip"
   */
  readonly expectedFailures?: ReadonlyArray<string>;
}

export interface TabularContractHandle {
  readonly createCompoundRepo: () => Promise<
    ITabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>
  >;
  readonly createVectorRepo?: () => Promise<
    ITabularStorage<typeof VectorSchema, typeof VectorPrimaryKeyNames>
  >;
  readonly dispose: () => Promise<void>;
}
```

`VectorSchema` is exported from `fixtures.ts`:

```ts
export const VectorPrimaryKeyNames = ["id"] as const;
export const VectorSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    embedding: { type: "string", format: "TypedArray:Float32:384" },
  },
  required: ["id", "embedding"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export const DEFAULT_VECTOR_DIMENSION = 384;
```

### Asserted blocks

| Block | Capability | What's asserted | Bug it catches |
|---|---|---|---|
| Subscribe fires once per write | `subscriptions` | After N `put()` calls, the callback fires exactly N times; payload `type` matches the operation. | duplicate notifications; missed-write notifications |
| Subscribe commit order | `subscriptions` | Three writes A, B, C arrive in callback order A → B → C. For polling backends, ordering is asserted within the polled batch. | reordered notifications |
| Vector dimension round-trip | `vectorColumns` | Insert `{ id: "x", embedding: new Float32Array(384) }`, read back, assert `result.embedding instanceof Float32Array && result.embedding.length === 384`. | Postgres silently degrading vector schemas to `TEXT` |

The fire-once test is *new* coverage — the existing
`genericTabularStorageSubscriptionTests.ts` only checks "callback was
called", not "called exactly N times". The commit-order test extends the
existing "should fire in order" test with strict count + sequence
verification.

### Caller wiring

Each adapter's existing test file gets a second call:

```ts
// packages/test/src/test/storage-tabular/PostgresTabularStorage.integration.test.ts
runGenericTabularStorageTests(/* unchanged */);
runTabularStorageContractTests({
  name: "Postgres",
  skip: !RUN_POSTGRES_TESTS,
  timeout: 30_000,
  factory: async () => ({
    createCompoundRepo: () => /* same factory shape as today */,
    createVectorRepo: () => /* schema with TypedArray:Float32:384 */,
    dispose: async () => /* close pool */,
  }),
  capabilities: { subscriptions: true, vectorColumns: true },
  expectedFailures: ["subscribe.fireOncePerWrite", "subscribe.commitOrder"],
});
```

### Adapter coverage

| Adapter | `subscriptions` | `vectorColumns` | `expectedFailures` |
|---|---|---|---|
| InMemory | true | false | none |
| IndexedDB | true | false | none |
| FsFolder | true | false | none |
| Cached (in-memory backed) | true | false | none |
| Postgres | true | true | `subscribe.fireOncePerWrite`, `subscribe.commitOrder` (until LISTEN/NOTIFY feature spec lands); `vector.dimensionRoundTrip` (until Phase 4 fixes the parser) |
| SQLite | true | false | `subscribe.fireOncePerWrite`, `subscribe.commitOrder` (until polling/`update_hook` feature spec lands) |
| Supabase | true | false | none — Supabase already exposes realtime subscriptions |
| HuggingFace | false | false | n/a — read-only adapter |

`vectorColumns: true` is initially exclusive to Postgres because
pgvector is the only adapter today that has vector-typed columns. The
implementation phase verifies whether the round-trip assertion also
passes on adapters that store TypedArray as bytes/JSON without typed
columns (InMemory, IndexedDB, SQLite, etc.). If yes, `vectorColumns:
true` extends to those adapters and the contract becomes "the storage
preserves `Float32Array` shape end-to-end". If no, it stays
Postgres-only.

## Phasing

This spec ships as four phases within a single project (one branch,
multiple PRs acceptable; Phases 2 and 3 may land in the same PR for
exercisability).

### Phase 1 — Move shared polyfill

- Move `packages/test/src/contract/ai-provider/assertions/itExpectFail.ts`
  → `packages/test/src/contract/itExpectFail.ts`.
- Update the two existing AiProvider import paths
  (`signalHonoring.ts`, `sessionReuse.ts`).

### Phase 2 — Contract suite implementation

- Create `types.ts`, `fixtures.ts`,
  `runTabularStorageContractTests.ts`, and three assertion modules
  under `packages/test/src/contract/storage-tabular/`.
- All assertion blocks land. Suite passes on adapters that already
  conform (InMemory, IndexedDB, FsFolder, Cached, Supabase).

### Phase 3 — Caller wiring

- Each of the 7 existing `*TabularStorage.{integration.}test.ts` files
  adds a second call to `runTabularStorageContractTests({...})`.
- Postgres + SQLite mark `subscribe.fireOncePerWrite` and
  `subscribe.commitOrder` as `expectedFailures`.
- Postgres marks `vector.dimensionRoundTrip` as `expectedFailures`
  *temporarily* — Phase 4 fixes it and removes the entry.
- Verify during implementation whether `vectorColumns: true` applies
  beyond Postgres; update remaining flags accordingly.
- Foundations README at `packages/test/src/contract/README.md` gets a
  row added to the suites table for Tabular Storage.

### Phase 4 — Fix Postgres vector-dimension parser

- `PostgresTabularStorage.getVectorDimensions` currently returns
  `undefined`. Implement:

  ```ts
  protected getVectorDimensions(typeDef: JsonSchema): number | undefined {
    const fmt = typeDef && typeof typeDef === "object"
      ? (typeDef as { format?: string }).format
      : undefined;
    if (!fmt) return undefined;
    const m = /^TypedArray:[A-Za-z0-9_]+:(\d+)$/.exec(fmt);
    return m ? Number(m[1]) : undefined;
  }
  ```

- Remove `vector.dimensionRoundTrip` from Postgres's
  `expectedFailures`.
- Verify the assertion now passes against Postgres.

## Success criteria

- All 7 existing storage-tabular adapter tests still pass after
  Phase 3 wiring (no regressions).
- New contract tests run in CI without new env vars or external
  services.
- The two named bugs (Postgres vector-dimension `undefined`,
  Postgres/SQLite `subscribeToChanges` throw) are surfaced as either
  green tests or `expectedFailures` entries in CI — never silently
  absent.
- Adding an 8th tabular storage adapter requires writing one shim
  factory (~30 lines).

## Roadmap

Tracked but out of scope for this spec.

1. `subscribeToChanges` real implementation for Postgres (LISTEN/NOTIFY)
   and SQLite (polling fallback or `update_hook`).
2. `putBulk` round-trip count and `deleteSearch` streaming assertions —
   needs a query-instrumentation API spec first.
3. Migrate the 2,039-line `genericTabularStorageTests.ts` legacy file
   into `packages/test/src/contract/storage-tabular/`.
4. Worker-proxy / IBrowserContext / EntitlementProfile / IHumanConnector
   — remaining four contract suites from the AiProvider design's
   roadmap.

## Open questions

None blocking. The implementation phase resolves whether
`vectorColumns: true` extends beyond Postgres.

## References

- `docs/superpowers/specs/2026-05-04-aiprovider-contract-conformance-design.md`
  — predecessor spec; foundations conventions inherited.
- `docs/superpowers/plans/2026-05-04-aiprovider-contract-conformance.md`
  — predecessor implementation plan; same phase structure.
- `packages/test/src/test/storage-tabular/genericTabularStorageTests.ts`
  — legacy generic suite (2,039 lines); stays in place.
- `packages/test/src/test/storage-tabular/genericTabularStorageSubscriptionTests.ts`
  — existing subscription tests; stay in place; the contract suite
  adds *new* invariants beyond what's here.
- `packages/storage/src/tabular/ITabularStorage.ts:285`
  — `subscribeToChanges` interface declaration.
- `packages/postgres/src/storage/PostgresTabularStorage.ts:146`
  — `getVectorDimensions` returning `undefined`.
- `packages/postgres/src/storage/PostgresTabularStorage.ts:1030`
  — Postgres `subscribeToChanges` throw.
- `packages/sqlite/src/storage/SqliteTabularStorage.ts:1013`
  — SQLite `subscribeToChanges` throw.
