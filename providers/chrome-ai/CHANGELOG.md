# Changelog

## 0.3.4

## 0.3.3

## 0.3.2

## 0.3.1

## 0.3.0

## 0.2.37

### Features

- Add pluggable disposal strategies to ResourceScope (#509)

## 0.2.36

## 0.2.35

### Features

#### ai,test,ci

- bridgeProgress utility and large-model integration test harness

#### ai

- introduce capability-based dispatch (Phases 0-4)

### Bug Fixes

#### ai,hft,test,ci

- resolve RAG WASM/ONNX memory leaks

### Refactors

#### ai

- finalize Promise+emit migration and cleanup
- migrate execution path to Promise+emit shape

#### providers

- migrate all providers to AiProviderRunFnRegistration[] (Phase 5)

### Chores

- release 30 packages
- release 30 packages
- fixup comment references to things renamed
- fixup some wrong links after rename

#### format

- organize-imports plugin + husky pre-commit hook (#488)

### CI

- empty commit to retrigger main Build & Test

## 0.2.34

## 0.2.33

### Chores

- fixup comment references to things renamed
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

### Refactors

#### ai-provider

- replace WebBrowserQueuedProvider with WebBrowserProvider

## 0.2.30

### Refactors

#### chrome-ai

- rename @workglow/chrome to @workglow/chrome-ai (#457)

### Chores

- update peer deps

## 0.2.29

## 0.2.28

### Refactors

#### chrome

- move provider from @workglow/ai-provider to @workglow/chrome

### Documentation

- update stale @workglow/ai-provider/* and @workglow/storage/* references in JSDoc
