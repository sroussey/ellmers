# Changelog

## 0.3.21

## 0.3.20

## 0.3.19

## 0.3.18

## 0.3.17

## 0.3.16

### Refactors

#### storage

- enhance unique index handling and event emission

## 0.3.15

### Bug Fixes

- eslint fixes

#### storage

- include rolled-back ids in rollback event payload (#591)

#### storage,indexeddb,postgres,sqlite

- cumulative vector-storage validation + atomicity hardening (#580/#581/#583/#584/#587) (#589)

### Refactors

- extract shared Postgres type mapping and vector storage logic (#586)

### Build

- make timings easier to spot trouble

### Chores

- add homepage

## Unreleased

### Bug Fixes

#### storage,indexeddb

- validate vector shape on `IndexedDbVectorStorage` `put` / `putBulk` /
  `similaritySearch` (paired with the matching `InMemoryVectorStorage` fix in
  `@workglow/storage`). Validation runs synchronously before any IDB
  transaction opens, so a malformed `putBulk` rejects the whole batch with no
  partial write reaching the object store.

#### indexeddb

- `IndexedDbVectorStorage.putBulk` now routes every record through a single
  `readwrite` IDB transaction instead of inheriting the
  one-transaction-per-row `Promise.all` path. A request error, transaction
  abort, or quota failure on any record aborts the whole batch — no row
  reaches the object store. **Behaviour change for subscribers**: per-row
  `put` events for a batched put now fire as a burst from `tx.oncomplete`
  rather than interleaved with each IDB request. Consumers that relied on
  the request-level ordering (none in this repo) should switch to
  `tx.oncomplete` semantics.
- `IndexedDbTabularStorage` exposes `protected putBulkInTransaction()` so
  storages that need an atomic batch can route through a single transaction;
  the base `putBulk` is unchanged to preserve existing per-row event
  semantics for non-vector callers. An `InvalidStateError` raised by an
  `onversionchange` race is absorbed with a single open-and-retry, and a
  `rollback` event fires on the storage emitter when the retry path runs.
- The per-record key-derivation logic (autoincrement, UUID,
  `clientProvidedKeys`) is now extracted into
  `protected prepareRecordForPut()` and shared by `put` /
  `putBulkInTransaction`, eliminating drift between the single- and
  batch-write paths.

## 0.3.14

### Features

- add bugs URL to package.json files across all packages and providers

## 0.3.13

## 0.3.12

### Refactors

- rework delete events

### Chores

- comment review pass across packages and providers

## 0.3.11

## 0.3.10

## 0.3.9

## 0.3.8

## 0.3.7

## 0.3.6

## 0.3.5

## 0.3.4

## 0.3.3

## 0.3.2

### Refactors

- remove pre-v1 backward-compat code paths (#523)

## 0.3.1

## 0.3.0

### Features

#### job-queue

- IJobStore decomposition + processClaims for cloud transports

## 0.2.37

### Features

- Add pluggable disposal strategies to ResourceScope (#509)

### Bug Fixes

#### job-queue

- follow-up correctness fixes to PR #511 (#513)

### Refactors

#### job-queue

- drop legacy limiter methods, fix QueuedExecutionStrategy release, rename releaseClaim (#511)

## 0.2.36

## 0.2.35

### Features

#### knowledge-base

- hybrid search via RRF over BM25F text index (#478)

### Documentation

- add design for storage getBulk plural-get (#480)

### Chores

- release 30 packages
- release 30 packages
- fixup some wrong links after rename

#### format

- organize-imports plugin + husky pre-commit hook (#488)

### CI

- empty commit to retrigger main Build & Test

## 0.2.34

## 0.2.33

### Chores

- fixup some wrong links after rename

## 0.2.32

### Features

#### indexeddb

- wire tabular migration applier into setupDatabase
- wire tabular migration applier into setupDatabase
- tabular migration applier
- add migration runner + per-component migrations

### Bug Fixes

#### tabular-migrations

- address Copilot review feedback

#### indexeddb

- settle probe and upgrade promises exactly once
- serialize migrations per-dbName to avoid open-version deadlock

### Refactors

- finish renaming stuff for ai-provider now that ai-provider is in ai
- move packages with big third party libraries from packages to providers
- remove setupDatabase() from queue/rate-limiter, plumb migration progress

#### indexeddb

- share single openIdb helper across storages

### Documentation

- add README files for new packages

### Chores

- fix merge issues after rebase and do a format

#### tabular-migrations

- final formatting + scripts/test.ts wiring

### CI

- retrigger build
- retrigger after transient @sqlite.org/sqlite-wasm resolution failure

## 0.2.31

## 0.2.30

### Chores

- update peer deps

## 0.2.29

## 0.2.28

### Refactors

#### indexeddb

- move IndexedDB backends from @workglow/storage to @workglow/indexeddb

### Chores

- format
