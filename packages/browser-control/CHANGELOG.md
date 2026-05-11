# Changelog

## 0.2.33

### Chores

- fixup some wrong links after rename

## 0.2.32

### Refactors

- move packages with big third party libraries from packages to providers

#### browser-control

- split backends into per-vendor provider packages

### Tests

#### browser-context

- add IBrowserContext contract conformance suite (#470)

### Documentation

- add README files for new packages

### CI

- retrigger build
- retrigger after transient @sqlite.org/sqlite-wasm resolution failure

## 0.2.31

### Chores

- no electron in browser control just yet

## 0.2.30

### Chores

- update peer deps

## 0.2.29

## 0.2.28

### Refactors

#### tasks

- strip MCP and browser-control auto-registration from runtime entries

#### browser-control

- move browser-control backends from @workglow/tasks to @workglow/browser-control

### Chores

- code-review fixes (round 2)
- format
