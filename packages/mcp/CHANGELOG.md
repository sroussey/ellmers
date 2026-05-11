# Changelog

## 0.2.34

## 0.2.33

### Chores

- fixup some wrong links after rename

## 0.2.32

### Features

#### test

- IHumanConnector contract conformance suite (#471)

### Refactors

- finish renaming stuff for ai-provider now that ai-provider is in ai
- move packages with big third party libraries from packages to providers

### Documentation

- add README files for new packages

### Chores

- format

### CI

- retrigger build
- retrigger after transient @sqlite.org/sqlite-wasm resolution failure

## 0.2.31

### Refactors

- introduce bootstrapWorkglow and createOrchestrationContext (#460)

## 0.2.30

### Chores

- update peer deps

## 0.2.29

## 0.2.28

### Bug Fixes

#### mcp

- tasks → util cross-subpath imports use package self-name

### Refactors

#### tasks

- strip MCP and browser-control auto-registration from runtime entries

#### mcp

- move MCP tasks and util from @workglow/tasks to @workglow/mcp

### Chores

- code-review fixes (round 2)
- code-review cleanup
