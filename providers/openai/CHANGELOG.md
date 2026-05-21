# Changelog

## 0.3.1

## 0.3.0

## 0.2.37

### Features

- Add pluggable disposal strategies to ResourceScope (#509)

## 0.2.36

## 0.2.35

### Features

#### ai

- introduce capability-based dispatch (Phases 0-4)

### Bug Fixes

#### ai,hft,test,ci

- resolve RAG WASM/ONNX memory leaks

#### ai,providers,test

- Phase 5 review feedback and CI/test fixes

### Refactors

- shared promise on import for optional ai provider libs
- remove loadProviderSdk utility and streamline SDK loading in client implementations

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

### Refactors

- shared promise on import for optional ai provider libs
- remove loadProviderSdk utility and streamline SDK loading in client implementations

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

## 0.2.30

### Refactors

#### ai-provider

- extract cloud provider mixin and OpenAI-shape chat helper (#459)

### Chores

- update peer deps

## 0.2.29

### Refactors

#### ai-provider

- enhance model search functionality

## 0.2.28

### Refactors

#### ai-provider

- final trim of vendor subpaths and SDK peers

#### openai

- move provider from @workglow/ai-provider to @workglow/openai

### Documentation

- update stale @workglow/ai-provider/* and @workglow/storage/* references in JSDoc
