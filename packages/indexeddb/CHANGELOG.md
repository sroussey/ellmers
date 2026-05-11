# Changelog

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
