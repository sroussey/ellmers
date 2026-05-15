# Changelog

## 0.2.36

## 0.2.35

### Features

#### knowledge-base

- hybrid search via RRF over BM25F text index (#478)

### Bug Fixes

#### storage-migrations

- serialize concurrent runs and roll back partial SQLite schema (#485)

### Tests

#### sqlite-vector

- add @sqliteai/sqlite-vector to packages/test and fix ESM extension loading (#492)

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

### Refactors

- finish renaming stuff for ai-provider now that ai-provider is in ai
- move packages with big third party libraries from packages to providers

### Documentation

- add README files for new packages

### CI

- retrigger build
- retrigger after transient @sqlite.org/sqlite-wasm resolution failure

## 0.2.31

### Chores

- fixup sqlite related packages

## 0.2.30

### Chores

- update peer deps

## 0.2.29

## 0.2.28

### Refactors

#### sqlite

- move SQLite backends from @workglow/storage to @workglow/sqlite

### Documentation

- update stale @workglow/ai-provider/* and @workglow/storage/* references in JSDoc
