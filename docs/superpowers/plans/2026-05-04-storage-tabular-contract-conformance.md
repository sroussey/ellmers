# Tabular Storage Contract Conformance Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `runTabularStorageContractTests` parameterized suite under `packages/test/src/contract/storage-tabular/` that asserts two new behavioral invariants (`subscribeToChanges` fire-once + commit-order, vector column TypedArray:N round-trip). Wire all seven storage adapter test files to the new suite as a second call alongside the existing legacy suite. Fix the Postgres `getVectorDimensions` parser as the final phase.

**Architecture:** Mirrors the AiProvider contract pattern (PR #461 merged). New top-level `packages/test/src/contract/storage-tabular/` directory with types, fixtures, three per-assertion modules, and an entrypoint. The shared `itExpectFail` polyfill moves up to `packages/test/src/contract/itExpectFail.ts` so multiple contract suites can use it. Existing 2,039-line `genericTabularStorageTests.ts` stays in place — the contract suite is *additive*, not a replacement.

**Tech Stack:** TypeScript, Vitest, Bun workspace. PGlite (in-memory Postgres) used by the Postgres test caller; pgvector extension loaded for vector-column tests.

**Spec:** `docs/superpowers/specs/2026-05-04-storage-tabular-contract-conformance-design.md`.

---

## File structure

**Phase 1 (Move shared polyfill)**
- Move: `packages/test/src/contract/ai-provider/assertions/itExpectFail.ts` → `packages/test/src/contract/itExpectFail.ts`
- Modify: `packages/test/src/contract/ai-provider/assertions/signalHonoring.ts` (import path)
- Modify: `packages/test/src/contract/ai-provider/assertions/sessionReuse.ts` (import path)

**Phase 2 (Contract suite implementation)**
- Create: `packages/test/src/contract/storage-tabular/types.ts`
- Create: `packages/test/src/contract/storage-tabular/fixtures.ts` — exports `VectorSchema`, `VectorPrimaryKeyNames`, `DEFAULT_VECTOR_DIMENSION`
- Create: `packages/test/src/contract/storage-tabular/runTabularStorageContractTests.ts`
- Create: `packages/test/src/contract/storage-tabular/assertions/subscribeFireOnce.ts`
- Create: `packages/test/src/contract/storage-tabular/assertions/subscribeCommitOrder.ts`
- Create: `packages/test/src/contract/storage-tabular/assertions/vectorDimensionRoundTrip.ts`

**Phase 3 (Caller wiring)**
- Modify: `packages/test/src/test/storage-tabular/InMemoryTabularStorage.test.ts`
- Modify: `packages/test/src/test/storage-tabular/IndexedDbTabularStorage.integration.test.ts`
- Modify: `packages/test/src/test/storage-tabular/FsFolderTabularStorage.integration.test.ts`
- Modify: `packages/test/src/test/storage-tabular/CachedTabularStorage.integration.test.ts`
- Modify: `packages/test/src/test/storage-tabular/PostgresTabularStorage.integration.test.ts` (also enables pgvector in PGlite)
- Modify: `packages/test/src/test/storage-tabular/SqliteTabularStorage.integration.test.ts`
- Modify: `packages/test/src/test/storage-tabular/SupabaseTabularStorage.integration.test.ts`
- Modify: `packages/test/src/test/storage-tabular/HuggingFaceTabularStorage.integration.test.ts`
- Modify: `packages/test/src/contract/README.md` — add row to suites table

**Phase 4 (Postgres vector-dimension fix)**
- Modify: `packages/postgres/src/storage/PostgresTabularStorage.ts:146-148` — implement parser
- Modify: `packages/test/src/test/storage-tabular/PostgresTabularStorage.integration.test.ts` — remove `vector.dimensionRoundTrip` from `expectedFailures`

---

# Phase 1 — Move shared polyfill

### Task 1.1: Move itExpectFail and update AiProvider imports

**Files:**
- Move: `packages/test/src/contract/ai-provider/assertions/itExpectFail.ts` → `packages/test/src/contract/itExpectFail.ts`
- Modify: `packages/test/src/contract/ai-provider/assertions/signalHonoring.ts`
- Modify: `packages/test/src/contract/ai-provider/assertions/sessionReuse.ts`

- [ ] **Step 1: Move the file**

```bash
git mv packages/test/src/contract/ai-provider/assertions/itExpectFail.ts \
       packages/test/src/contract/itExpectFail.ts
```

- [ ] **Step 2: Update import in `signalHonoring.ts`**

Find:
```ts
import { itExpectFail } from "./itExpectFail";
```

Replace with:
```ts
import { itExpectFail } from "../../itExpectFail";
```

- [ ] **Step 3: Update import in `sessionReuse.ts`**

Same change as Step 2.

- [ ] **Step 4: Type-check**

Run from repo root: `bun run build:types`
Expected: 56 successful tasks, 0 errors.

- [ ] **Step 5: Run AiProvider conformance to verify no regression**

Run: `bunx vitest run --root . packages/test/src/test/ai-provider/Anthropic_Generic.integration.test.ts`
Expected: 11 passed | 3 skipped (or whatever the previously-passing baseline was after #461 merged).

- [ ] **Step 6: Commit**

```bash
git add packages/test/src/contract/itExpectFail.ts \
        packages/test/src/contract/ai-provider/assertions/signalHonoring.ts \
        packages/test/src/contract/ai-provider/assertions/sessionReuse.ts
git commit -m "test: move itExpectFail polyfill to contract/ root for cross-suite reuse"
```

---

# Phase 2 — Tabular storage contract suite

> Phase 2 lands the suite implementation. Phase 3 follows in the same PR (the suite must have a caller to be exercised in CI; minimum is wiring InMemory at the end of Phase 2 as a smoke check).

### Task 2.1: Define types

**Files:**
- Create: `packages/test/src/contract/storage-tabular/types.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import type {
  CompoundPrimaryKeyNames,
  CompoundSchema,
} from "../../test/storage-tabular/genericTabularStorageTests";
import type { VectorPrimaryKeyNames, VectorSchema } from "./fixtures";

export interface TabularStorageContractOpts {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout: number;
  readonly factory: () => Promise<TabularContractHandle>;
  readonly capabilities: TabularContractCapabilities;
  readonly subscriptions?: TabularSubscriptionOptions;
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

export interface TabularContractCapabilities {
  readonly subscriptions: boolean;
  readonly vectorColumns: boolean;
}

export interface TabularSubscriptionOptions {
  readonly usesPolling?: boolean;
  readonly pollingIntervalMs?: number;
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

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/storage-tabular/types.ts
git commit -m "test(storage-tabular): contract suite types"
```

### Task 2.2: Define fixtures

**Files:**
- Create: `packages/test/src/contract/storage-tabular/fixtures.ts`

- [ ] **Step 1: Write `fixtures.ts`**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util/schema";

export const DEFAULT_VECTOR_DIMENSION = 384;

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
```

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/storage-tabular/fixtures.ts
git commit -m "test(storage-tabular): contract fixtures (VectorSchema, default dimension)"
```

### Task 2.3: Implement subscribeFireOnce assertion

**Files:**
- Create: `packages/test/src/contract/storage-tabular/assertions/subscribeFireOnce.ts`

This block asserts: after N `put()` calls with distinct primary keys, the
`subscribeToChanges` callback fires exactly N times. The existing
`genericTabularStorageSubscriptionTests` only asserts that the callback
fired *at least once*; this asserts the exact count.

- [ ] **Step 1: Write the assertion module**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TabularChangePayload } from "@workglow/storage";
import { sleep } from "@workglow/util";
import type { FromSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { itExpectFail } from "../../itExpectFail";
import type {
  CompoundPrimaryKeyNames,
  CompoundSchema,
} from "../../../test/storage-tabular/genericTabularStorageTests";
import type { TabularContractHandle, TabularStorageContractOpts } from "../types";

type CompoundEntity = FromSchema<typeof CompoundSchema>;

export function subscribeFireOnceBlock(
  opts: TabularStorageContractOpts,
  getHandle: () => TabularContractHandle
): void {
  const enabled = opts.capabilities.subscriptions;
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itImpl = expectFails.has("subscribe.fireOncePerWrite") ? itExpectFail : it;
  const usesPolling = opts.subscriptions?.usesPolling ?? false;
  const pollingIntervalMs = opts.subscriptions?.pollingIntervalMs ?? 1;
  const initWaitTime = usesPolling ? Math.max(pollingIntervalMs * 10, 300) : 10;
  const settleWaitTime = usesPolling ? Math.max(pollingIntervalMs * 8, 200) : 50;

  describe.skipIf(!enabled)("Subscribe fires once per write", () => {
    let repo: Awaited<ReturnType<TabularContractHandle["createCompoundRepo"]>>;

    beforeEach(async () => {
      repo = await getHandle().createCompoundRepo();
      await repo.setupDatabase?.();
    });

    afterEach(async () => {
      await repo.deleteAll();
      repo.destroy();
    });

    itImpl(
      "callback fires exactly once per put with INSERT type",
      async () => {
        const changes: TabularChangePayload<CompoundEntity>[] = [];
        const unsubscribe = repo.subscribeToChanges(
          (change) => changes.push(change),
          opts.subscriptions
        );
        await sleep(initWaitTime);

        const writes = [
          { name: "a", type: "t", option: "o1", success: true },
          { name: "b", type: "t", option: "o2", success: true },
          { name: "c", type: "t", option: "o3", success: true },
        ];
        for (const w of writes) await repo.put(w);
        await sleep(settleWaitTime);

        const inserts = changes.filter((c) => c.type === "INSERT");
        expect(inserts.length).toBe(writes.length);

        unsubscribe();
      },
      opts.timeout
    );
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/storage-tabular/assertions/subscribeFireOnce.ts
git commit -m "test(storage-tabular): subscribe fire-once-per-write assertion"
```

### Task 2.4: Implement subscribeCommitOrder assertion

**Files:**
- Create: `packages/test/src/contract/storage-tabular/assertions/subscribeCommitOrder.ts`

Asserts: three sequential writes A → B → C arrive in callback order.
For polling backends, ordering is asserted within whatever batch the
poller delivers (commit ordering is preserved within a batch but not
necessarily across batches; the test makes the writes synchronous to
keep them in one batch).

- [ ] **Step 1: Write the assertion module**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TabularChangePayload } from "@workglow/storage";
import { sleep } from "@workglow/util";
import type { FromSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { itExpectFail } from "../../itExpectFail";
import type {
  CompoundPrimaryKeyNames,
  CompoundSchema,
} from "../../../test/storage-tabular/genericTabularStorageTests";
import type { TabularContractHandle, TabularStorageContractOpts } from "../types";

type CompoundEntity = FromSchema<typeof CompoundSchema>;

export function subscribeCommitOrderBlock(
  opts: TabularStorageContractOpts,
  getHandle: () => TabularContractHandle
): void {
  const enabled = opts.capabilities.subscriptions;
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itImpl = expectFails.has("subscribe.commitOrder") ? itExpectFail : it;
  const usesPolling = opts.subscriptions?.usesPolling ?? false;
  const pollingIntervalMs = opts.subscriptions?.pollingIntervalMs ?? 1;
  const initWaitTime = usesPolling ? Math.max(pollingIntervalMs * 10, 300) : 10;
  const settleWaitTime = usesPolling ? Math.max(pollingIntervalMs * 8, 200) : 50;

  describe.skipIf(!enabled)("Subscribe commit order", () => {
    let repo: Awaited<ReturnType<TabularContractHandle["createCompoundRepo"]>>;

    beforeEach(async () => {
      repo = await getHandle().createCompoundRepo();
      await repo.setupDatabase?.();
    });

    afterEach(async () => {
      await repo.deleteAll();
      repo.destroy();
    });

    itImpl(
      "three sequential puts arrive in callback in commit order",
      async () => {
        const observedNames: string[] = [];
        const unsubscribe = repo.subscribeToChanges(
          (change) => {
            const c = change as TabularChangePayload<CompoundEntity>;
            if (c.type === "INSERT" && c.new) {
              observedNames.push(c.new.name);
            }
          },
          opts.subscriptions
        );
        await sleep(initWaitTime);

        await repo.put({ name: "alpha", type: "t", option: "x", success: true });
        await repo.put({ name: "bravo", type: "t", option: "y", success: true });
        await repo.put({ name: "charlie", type: "t", option: "z", success: true });
        await sleep(settleWaitTime);

        expect(observedNames).toEqual(["alpha", "bravo", "charlie"]);

        unsubscribe();
      },
      opts.timeout
    );
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/storage-tabular/assertions/subscribeCommitOrder.ts
git commit -m "test(storage-tabular): subscribe commit-order assertion"
```

### Task 2.5: Implement vectorDimensionRoundTrip assertion

**Files:**
- Create: `packages/test/src/contract/storage-tabular/assertions/vectorDimensionRoundTrip.ts`

Asserts: writing a `Float32Array(N)` to a column declared
`format: "TypedArray:Float32:N"` round-trips with the same shape and
length.

- [ ] **Step 1: Write the assertion module**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { itExpectFail } from "../../itExpectFail";
import { DEFAULT_VECTOR_DIMENSION, VectorPrimaryKeyNames, VectorSchema } from "../fixtures";
import type { TabularContractHandle, TabularStorageContractOpts } from "../types";

export function vectorDimensionRoundTripBlock(
  opts: TabularStorageContractOpts,
  getHandle: () => TabularContractHandle
): void {
  const enabled = opts.capabilities.vectorColumns;
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itImpl = expectFails.has("vector.dimensionRoundTrip") ? itExpectFail : it;

  describe.skipIf(!enabled)("Vector column round-trip", () => {
    let repo: ITabularStorage<typeof VectorSchema, typeof VectorPrimaryKeyNames>;

    beforeEach(async () => {
      const handle = getHandle();
      if (!handle.createVectorRepo) {
        throw new Error(
          `${opts.name} declares vectorColumns=true but factory.createVectorRepo is undefined`
        );
      }
      repo = await handle.createVectorRepo();
      await repo.setupDatabase?.();
    });

    afterEach(async () => {
      await repo.deleteAll();
      repo.destroy();
    });

    itImpl(
      "Float32Array(384) round-trips preserving instance type and length",
      async () => {
        const embedding = new Float32Array(DEFAULT_VECTOR_DIMENSION);
        for (let i = 0; i < embedding.length; i++) {
          embedding[i] = (i + 1) / 1000;
        }
        await repo.put({ id: "v1", embedding });

        const fetched = await repo.get({ id: "v1" });
        expect(fetched).toBeDefined();
        expect(fetched!.embedding).toBeInstanceOf(Float32Array);
        expect((fetched!.embedding as Float32Array).length).toBe(DEFAULT_VECTOR_DIMENSION);

        // Spot-check a few values to confirm element-level fidelity.
        const round = fetched!.embedding as Float32Array;
        expect(round[0]).toBeCloseTo(0.001, 5);
        expect(round[round.length - 1]).toBeCloseTo(DEFAULT_VECTOR_DIMENSION / 1000, 5);
      },
      opts.timeout
    );
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/storage-tabular/assertions/vectorDimensionRoundTrip.ts
git commit -m "test(storage-tabular): vector dimension round-trip assertion"
```

### Task 2.6: Wire `runTabularStorageContractTests` entrypoint

**Files:**
- Create: `packages/test/src/contract/storage-tabular/runTabularStorageContractTests.ts`

- [ ] **Step 1: Write the entrypoint**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe } from "vitest";

import { subscribeCommitOrderBlock } from "./assertions/subscribeCommitOrder";
import { subscribeFireOnceBlock } from "./assertions/subscribeFireOnce";
import { vectorDimensionRoundTripBlock } from "./assertions/vectorDimensionRoundTrip";
import type { TabularContractHandle, TabularStorageContractOpts } from "./types";

export function runTabularStorageContractTests(opts: TabularStorageContractOpts): void {
  describe.skipIf(opts.skip)(`Tabular storage contract: ${opts.name}`, () => {
    let handle: TabularContractHandle | undefined;
    const getHandle = (): TabularContractHandle => {
      if (!handle) throw new Error("contract handle not initialized");
      return handle;
    };

    beforeAll(async () => {
      handle = await opts.factory();
    }, opts.timeout);

    afterAll(async () => {
      if (handle) await handle.dispose();
    });

    subscribeFireOnceBlock(opts, getHandle);
    subscribeCommitOrderBlock(opts, getHandle);
    vectorDimensionRoundTripBlock(opts, getHandle);
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/storage-tabular/runTabularStorageContractTests.ts
git commit -m "test(storage-tabular): wire runTabularStorageContractTests entrypoint"
```

---

# Phase 3 — Caller wiring

The 7 storage-tabular adapter test files add a *second* call alongside `runGenericTabularStorageTests(...)`. InMemory is wired first as a smoke check.

### Task 3.1: Wire InMemory as smoke check

**Files:**
- Modify: `packages/test/src/test/storage-tabular/InMemoryTabularStorage.test.ts`

- [ ] **Step 1: Add the contract suite call**

After the existing `runGenericTabularStorageSubscriptionTests(...)` call, before `runAutoGeneratedKeyTests(...)`, insert:

```ts
import { runTabularStorageContractTests } from "../../contract/storage-tabular/runTabularStorageContractTests";

// inside the existing describe("InMemoryTabularStorage", () => { ... })
runTabularStorageContractTests({
  name: "InMemory",
  timeout: 5_000,
  factory: async () => ({
    createCompoundRepo: async () =>
      new InMemoryTabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>(
        CompoundSchema,
        CompoundPrimaryKeyNames
      ),
    dispose: async () => {},
  }),
  capabilities: { subscriptions: true, vectorColumns: false },
  subscriptions: { usesPolling: false },
});
```

(The import goes at the top with the other imports.)

- [ ] **Step 2: Run the InMemory test file**

Run: `bunx vitest run --root . packages/test/src/test/storage-tabular/InMemoryTabularStorage.test.ts`
Expected: existing tests pass + 2 new "Tabular storage contract: InMemory" tests pass (vector block skipped).

If failures appear, debug before proceeding.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/test/storage-tabular/InMemoryTabularStorage.test.ts
git commit -m "test(storage-tabular): wire InMemory to contract suite (smoke check)"
```

### Task 3.2: Wire IndexedDB

**Files:**
- Modify: `packages/test/src/test/storage-tabular/IndexedDbTabularStorage.integration.test.ts`

- [ ] **Step 1: Read the existing file to identify the IndexedDB factory pattern**

Run: `cat packages/test/src/test/storage-tabular/IndexedDbTabularStorage.integration.test.ts`

- [ ] **Step 2: Add the contract suite call**

Insert (mirror the InMemory shape; use the same `IndexedDbTabularStorage` constructor that the existing file uses):

```ts
import { runTabularStorageContractTests } from "../../contract/storage-tabular/runTabularStorageContractTests";

runTabularStorageContractTests({
  name: "IndexedDB",
  timeout: 5_000,
  factory: async () => ({
    createCompoundRepo: async () =>
      new IndexedDbTabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>(
        /* same constructor args as the existing factory in this file */
      ),
    dispose: async () => {},
  }),
  capabilities: { subscriptions: true, vectorColumns: false },
  subscriptions: {
    usesPolling: /* same value as the existing runGenericTabularStorageSubscriptionTests */,
    pollingIntervalMs: /* same value as the existing call */,
  },
});
```

The exact constructor args and `usesPolling` value are copied verbatim from this file's existing `runGenericTabularStorageSubscriptionTests` call.

- [ ] **Step 3: Run the IndexedDB test file**

Run: `bunx vitest run --root . packages/test/src/test/storage-tabular/IndexedDbTabularStorage.integration.test.ts`
Expected: existing tests pass + 2 new contract tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/test/storage-tabular/IndexedDbTabularStorage.integration.test.ts
git commit -m "test(storage-tabular): wire IndexedDB to contract suite"
```

### Task 3.3: Wire FsFolder

**Files:**
- Modify: `packages/test/src/test/storage-tabular/FsFolderTabularStorage.integration.test.ts`

- [ ] **Step 1: Read existing file**

Run: `cat packages/test/src/test/storage-tabular/FsFolderTabularStorage.integration.test.ts`

- [ ] **Step 2: Mirror Task 3.2's pattern using `FsFolderTabularStorage`**

Same shape: `capabilities: { subscriptions: true, vectorColumns: false }`. Reuse `usesPolling` / `pollingIntervalMs` values from this file's existing subscription call.

- [ ] **Step 3: Run + commit**

```
bunx vitest run --root . packages/test/src/test/storage-tabular/FsFolderTabularStorage.integration.test.ts
git add packages/test/src/test/storage-tabular/FsFolderTabularStorage.integration.test.ts
git commit -m "test(storage-tabular): wire FsFolder to contract suite"
```

### Task 3.4: Wire Cached

**Files:**
- Modify: `packages/test/src/test/storage-tabular/CachedTabularStorage.integration.test.ts`

- [ ] **Step 1-3:** Same pattern as Task 3.3. `capabilities: { subscriptions: true, vectorColumns: false }`. Reuse the existing factory's constructor args and polling settings.

```
git commit -m "test(storage-tabular): wire Cached to contract suite"
```

### Task 3.5: Wire Postgres + enable pgvector in PGlite + mark expected-fails

**Files:**
- Modify: `packages/test/src/test/storage-tabular/PostgresTabularStorage.integration.test.ts`

- [ ] **Step 1: Enable pgvector extension in PGlite**

Replace the existing PGlite construction:

```ts
const db = new PGlite() as unknown as Pool;
```

with:

```ts
import { vector } from "@electric-sql/pglite/vector";

const db = new PGlite({ extensions: { vector } }) as unknown as Pool;
```

- [ ] **Step 2: Verify pgvector loaded**

Add a `beforeAll` inside the `describe("PostgresTabularStorage", ...)` block that runs `CREATE EXTENSION IF NOT EXISTS vector` against the PGlite instance:

```ts
import { afterAll, beforeAll, describe } from "vitest";

// inside describe("PostgresTabularStorage", () => { ... }) — before the existing afterAll
beforeAll(async () => {
  await (db as unknown as PGlite).exec("CREATE EXTENSION IF NOT EXISTS vector");
});
```

- [ ] **Step 3: Add the contract suite call**

```ts
import { runTabularStorageContractTests } from "../../contract/storage-tabular/runTabularStorageContractTests";
import {
  VectorPrimaryKeyNames,
  VectorSchema,
} from "../../contract/storage-tabular/fixtures";

runTabularStorageContractTests({
  name: "Postgres",
  timeout: 30_000,
  factory: async () => ({
    createCompoundRepo: async () => {
      const repo = new PostgresTabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>(
        db,
        `sql_test_${uuid4().replace(/-/g, "_")}`,
        CompoundSchema,
        CompoundPrimaryKeyNames
      );
      return repo;
    },
    createVectorRepo: async () => {
      const repo = new PostgresTabularStorage<typeof VectorSchema, typeof VectorPrimaryKeyNames>(
        db,
        `vec_test_${uuid4().replace(/-/g, "_")}`,
        VectorSchema,
        VectorPrimaryKeyNames
      );
      return repo;
    },
    dispose: async () => {},
  }),
  capabilities: { subscriptions: true, vectorColumns: true },
  // TODO(workglow): subscribeToChanges throws "not supported" today.
  // Real LISTEN/NOTIFY implementation tracked as a follow-up feature spec.
  // vector.dimensionRoundTrip is fixed in Phase 4 — entry removed there.
  expectedFailures: [
    "subscribe.fireOncePerWrite",
    "subscribe.commitOrder",
    "vector.dimensionRoundTrip",
  ],
});
```

- [ ] **Step 4: Run the Postgres test file**

Run: `bunx vitest run --root . packages/test/src/test/storage-tabular/PostgresTabularStorage.integration.test.ts`
Expected: existing tests pass + 3 contract tests recorded as expected-fail (none should pass-when-expected-fail; if any do, that's a real bug).

- [ ] **Step 5: Commit**

```bash
git add packages/test/src/test/storage-tabular/PostgresTabularStorage.integration.test.ts
git commit -m "test(storage-tabular): wire Postgres to contract suite + enable pgvector"
```

### Task 3.6: Wire SQLite + mark expected-fails

**Files:**
- Modify: `packages/test/src/test/storage-tabular/SqliteTabularStorage.integration.test.ts`

- [ ] **Step 1: Read existing file** for constructor args.

- [ ] **Step 2: Add contract suite call**

```ts
import { runTabularStorageContractTests } from "../../contract/storage-tabular/runTabularStorageContractTests";

runTabularStorageContractTests({
  name: "SQLite",
  timeout: 5_000,
  factory: async () => ({
    createCompoundRepo: async () => /* same shape as existing factory */,
    dispose: async () => {},
  }),
  capabilities: { subscriptions: true, vectorColumns: false },
  // TODO(workglow): subscribeToChanges throws "not supported" today.
  // Real polling/update_hook implementation tracked as a follow-up feature spec.
  expectedFailures: ["subscribe.fireOncePerWrite", "subscribe.commitOrder"],
});
```

- [ ] **Step 3: Run + commit**

```
bunx vitest run --root . packages/test/src/test/storage-tabular/SqliteTabularStorage.integration.test.ts
git add packages/test/src/test/storage-tabular/SqliteTabularStorage.integration.test.ts
git commit -m "test(storage-tabular): wire SQLite to contract suite (subscribe expected-fail)"
```

### Task 3.7: Wire Supabase

**Files:**
- Modify: `packages/test/src/test/storage-tabular/SupabaseTabularStorage.integration.test.ts`

- [ ] **Step 1-3:** Mirror Task 3.6 with these capability flags (Supabase realtime subscriptions are expected to work; no `expectedFailures`):

```ts
capabilities: { subscriptions: true, vectorColumns: false },
subscriptions: { usesPolling: false },
// no expectedFailures
```

```
git commit -m "test(storage-tabular): wire Supabase to contract suite"
```

### Task 3.8: Wire HuggingFace

**Files:**
- Modify: `packages/test/src/test/storage-tabular/HuggingFaceTabularStorage.integration.test.ts`

- [ ] **Step 1-3:** HuggingFace storage is read-only and does not support subscriptions or vector typing. Capability flags both `false` — the contract suite's `describe.skipIf(!enabled)` blocks all skip:

```ts
capabilities: { subscriptions: false, vectorColumns: false },
```

```
git commit -m "test(storage-tabular): wire HuggingFace to contract suite (read-only)"
```

### Task 3.9: Update foundations README

**Files:**
- Modify: `packages/test/src/contract/README.md`

- [ ] **Step 1: Add a row to the suites table**

Find the table:
```markdown
| Contract | Suite | Adapters |
|---|---|---|
| `AiProvider` | `contract/ai-provider/runAiProviderConformance` | Anthropic, OpenAI, Gemini, Ollama, HF Inference, HF Transformers, LlamaCpp |
```

Add immediately after the AiProvider row:

```markdown
| `ITabularStorage` (contract) | `contract/storage-tabular/runTabularStorageContractTests` | InMemory, IndexedDB, FsFolder, Cached, Postgres, SQLite, Supabase, HuggingFace |
```

- [ ] **Step 2: Commit**

```bash
git add packages/test/src/contract/README.md
git commit -m "docs(contract): add tabular storage row to suites table"
```

### Task 3.10: Run the full storage-tabular vitest job

- [ ] **Step 1: Verify all adapters green**

Run: `bun scripts/test.ts integration storage vitest`
Expected: all storage-tabular suites pass; `expectedFailures` entries record as expected-fail (not regressions).

- [ ] **Step 2: Verify no `expectedFailures` typos**

Run: `grep -rn "expectedFailures" packages/test/src/test/storage-tabular/`
Confirm only the four expected entries (Postgres × 3, SQLite × 2). Wait — Postgres has 3, SQLite has 2 → 5 total entries across 2 files.

---

# Phase 4 — Fix Postgres vector-dimension parser

### Task 4.1: Implement getVectorDimensions parser

**Files:**
- Modify: `packages/postgres/src/storage/PostgresTabularStorage.ts:146-148`

- [ ] **Step 1: Read the existing method**

Run: `sed -n '140,160p' packages/postgres/src/storage/PostgresTabularStorage.ts`

The current implementation:
```ts
protected getVectorDimensions(typeDef: JsonSchema): number | undefined {
  return undefined;
}
```

- [ ] **Step 2: Replace with the parser**

```ts
protected getVectorDimensions(typeDef: JsonSchema): number | undefined {
  if (!typeDef || typeof typeDef !== "object") return undefined;
  const fmt = (typeDef as { format?: string }).format;
  if (!fmt) return undefined;
  const m = /^TypedArray:[A-Za-z0-9_]+:(\d+)$/.exec(fmt);
  return m ? Number(m[1]) : undefined;
}
```

The format suffix grammar is `TypedArray:<element>:<dimension>`, e.g. `TypedArray:Float32:384`. The `[A-Za-z0-9_]+` group accepts the typed-array element names used by `@workglow/util/schema` (Float32, Float64, Int8, Int16, Int32, Uint8, Uint16, Uint32, BigInt64, BigUint64, etc.).

- [ ] **Step 3: Type-check**

Run: `bun run build:types`
Expected: 0 errors.

- [ ] **Step 4: Remove `vector.dimensionRoundTrip` from Postgres expectedFailures**

Edit: `packages/test/src/test/storage-tabular/PostgresTabularStorage.integration.test.ts`

Find:
```ts
  expectedFailures: [
    "subscribe.fireOncePerWrite",
    "subscribe.commitOrder",
    "vector.dimensionRoundTrip",
  ],
```

Replace with:
```ts
  expectedFailures: [
    "subscribe.fireOncePerWrite",
    "subscribe.commitOrder",
  ],
```

Also remove the matching line of the TODO comment that references `vector.dimensionRoundTrip` if present.

- [ ] **Step 5: Run Postgres conformance**

Run: `bunx vitest run --root . packages/test/src/test/storage-tabular/PostgresTabularStorage.integration.test.ts`
Expected: `Vector column round-trip > Float32Array(384) round-trips ...` now passes as a regular `it`, not expected-fail. The two subscribe entries remain expected-fail.

- [ ] **Step 6: Commit**

```bash
git add packages/postgres/src/storage/PostgresTabularStorage.ts \
        packages/test/src/test/storage-tabular/PostgresTabularStorage.integration.test.ts
git commit -m "fix(postgres): parse vector dimension from TypedArray format suffix

Previously getVectorDimensions returned undefined unconditionally,
causing schemas with format \"TypedArray:Float32:N\" to silently degrade
to TEXT columns instead of pgvector vector(N). Parse the dimension from
the well-defined suffix grammar.

Removes vector.dimensionRoundTrip from Postgres conformance
expectedFailures."
```

### Task 4.2: Final verification

- [ ] **Step 1: Run full storage-tabular vitest job**

Run: `bun scripts/test.ts integration storage vitest`
Expected: all suites green; only `subscribe.fireOncePerWrite` and `subscribe.commitOrder` remain as expected-fails (Postgres + SQLite).

- [ ] **Step 2: Push**

```bash
git push -u origin claude/storage-tabular-contract-conformance
```

---

## Notes for the implementer

- **License header year**: this branch starts in 2026; new files use `Copyright 2026 Steven Roussey`. Existing files preserve their year per the repo convention.
- **TypeScript code style**: no default exports, `import type` for type-only imports, license header on every source file.
- **`as const satisfies DataPortSchemaObject`** — preserve the pattern in `fixtures.ts` for type narrowing.
- **PGlite vector extension**: only Postgres needs the Phase 3.5 pgvector enablement; other adapters' tests are unaffected.
- **Polling-backend flexibility**: `subscribeFireOnceBlock` and `subscribeCommitOrderBlock` use `usesPolling`/`pollingIntervalMs` to pad wait times — copy the values from each adapter's existing `runGenericTabularStorageSubscriptionTests` call to avoid configuration drift.
- **Phase 2 + 3 may land in a single PR** so the suite has at least one caller to be exercisable in CI. Phase 4 may be a follow-up PR if the reviewer prefers smaller diffs.
- **Discovery during Phase 3**: if any adapter's `vectorColumns: false` flag is wrong (the storage actually preserves Float32Array shape end-to-end), promote it to `true` in the same caller-wiring task. Open question from the spec.
