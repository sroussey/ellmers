# Changelog

## 0.3.28

## 0.3.27

### Bug Fixes

#### duckdb

- keep putBulk idempotent on all-primary-key tables

### Performance

#### duckdb

- single-statement putBulk via shared bulk engine

### Documentation

#### storage

- document single-statement putBulk and duplicate-key semantics

## Unreleased

### Refactors

#### duckdb

- `putBulk` now writes each chunk as a single multi-row `INSERT … RETURNING *`
  via the shared `BaseSqlTabularStorage` bulk engine, replacing the per-row
  insert loop. Atomicity, ordering (`result[i] === values[i]`), and deferred
  `put` events are preserved.

## 0.3.26

### Features

#### storage

- add DuckDB tabular storage backend (@workglow/duckdb) (#635)
