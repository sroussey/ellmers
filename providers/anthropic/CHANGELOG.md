# Changelog

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

#### anthropic

- move provider from @workglow/ai-provider to @workglow/anthropic

### Documentation

- update stale @workglow/ai-provider/* and @workglow/storage/* references in JSDoc
