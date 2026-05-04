# workglow

## 0.2.29

## 0.2.28

### Refactors

#### workglow

- drop optional vendor SDK peer dependencies

#### tasks

- strip MCP and browser-control auto-registration from runtime entries

#### mcp

- move MCP tasks and util from @workglow/tasks to @workglow/mcp

#### browser-control

- move browser-control backends from @workglow/tasks to @workglow/browser-control

#### javascript

- move JavaScriptTask + interpreter from @workglow/tasks to @workglow/javascript

#### ai-provider

- final trim of vendor subpaths and SDK peers

#### chrome

- move provider from @workglow/ai-provider to @workglow/chrome

#### tf-mediapipe

- move provider from @workglow/ai-provider to @workglow/tf-mediapipe

#### huggingface-inference

- move provider from @workglow/ai-provider to @workglow/huggingface-inference

#### huggingface-transformers

- move provider from @workglow/ai-provider to @workglow/huggingface-transformers

#### ollama

- move provider from @workglow/ai-provider to @workglow/ollama

#### google-gemini

- move provider from @workglow/ai-provider to @workglow/google-gemini

#### openai

- move provider from @workglow/ai-provider to @workglow/openai

#### anthropic

- move provider from @workglow/ai-provider to @workglow/anthropic

#### storage

- break temporary storage→job-queue cycle now that vendor queue impls are out

### Chores

- code-review fixes (round 2)

## 0.2.27

## 0.2.26

## 0.2.25

## 0.2.24

## 0.2.23

## 0.2.22

## 0.2.21

## 0.2.20

## 0.2.19

## 0.2.18

## 0.2.17

## 0.2.16

### Chores

- release 12 packages

## 0.2.15

## 0.2.14

## 0.2.13

## 0.2.12

## 0.2.11

## 0.2.10

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

## 0.2.5

## 0.2.4

## 0.2.3

## 0.2.2

## 0.2.1

## 0.2.0

### Features

- add pkg-pr-new for preview package publishing (#379)

### Chores

- release 12 packages

## 0.1.3

### Features

- add pkg-pr-new for preview package publishing (#379)

## 0.1.2

## 0.1.1

## 0.1.0

## 0.0.126

### Features

- update TypeScript configurations and package exports for improved module resolution

#### storage

- move @workglow/sqlite package into @workglow/storage/sqlite and add @workglow/storage/postgresql

#### example-web

- refactor storage implementation and update model imports

### Refactors

#### docs

- update import paths to use "workglow" instead of "@workglow" for consistency, sqlite all get init()

## 0.0.125

### Features

#### workglow

- implement custom build script and update package.json for improved build process
- add worker entry points for browser, Bun, and Node environments in consolidated workglow bundle

#### task-graph

- integrate Chrome DevTools formatters and update imports into task-graph, which is what it is used for. done moving this around now.

#### cli

- enhance CLI integration with task and workflow commands

#### storage

- SQLite: **`await Sqlite.init()`** before opening a database; same entrypoint on Node, Bun, and browser (re-exported from `workglow`)

### Refactors

#### debug

- remove @workglow/debug package and integrate debug utilities into @workglow/util

## 0.0.124

## 0.0.123

### Refactors

#### imports

- update imports to utilize @workglow/util/schema

## 0.0.122

### Features

#### schema

- introduce @workglow/schema package for schema validation utilities

### Refactors

- update package exports to use source files instead of dist
- split the sdk off to worker only
- reorg ai-provider a bit more
- ai provider

### Build

- no real point to splitting in the libs

### Chores

- add @typescript/native-preview package and make updates for tsgo

## 0.0.121

## 0.0.120

## 0.0.119

### Features

- add chrome web browser provider (#303)

### Chores

- release 14 packages

## 0.0.118

### Features

- add chrome web browser provider (#303)

## 0.0.117

## 0.0.116

### Refactors

- update type imports and SDK loading in AI provider modules

## 0.0.115

## 0.0.114

## 0.0.113

## 0.0.110

### Features

- add build-js and watch-js scripts across packages

## 0.0.109

## 0.0.108

## 0.0.107

### Bug Fixes

- enhance HuggingFace Transformers provider with streaming and reactive tasks support

## 0.0.106

## 0.0.105

### Patch Changes

- Storage rename search to query
- Updated dependencies
  - @workglow/ai@0.0.105
  - @workglow/ai-provider@0.0.105
  - @workglow/dataset@0.0.105
  - @workglow/debug@0.0.105
  - @workglow/job-queue@0.0.105
  - @workglow/sqlite@0.0.105
  - @workglow/storage@0.0.105
  - @workglow/task-graph@0.0.105
  - @workglow/tasks@0.0.105
  - @workglow/util@0.0.105

## 0.0.104

### Patch Changes

- Add credential storage and resolution handling
- Updated dependencies
  - @workglow/storage@0.0.104
  - @workglow/ai@0.0.104
  - @workglow/ai-provider@0.0.104
  - @workglow/dataset@0.0.104
  - @workglow/debug@0.0.104
  - @workglow/job-queue@0.0.104
  - @workglow/sqlite@0.0.104
  - @workglow/task-graph@0.0.104
  - @workglow/tasks@0.0.104
  - @workglow/util@0.0.104

## 0.0.103

### Patch Changes

- Structured Outputs, Task timeouts, Error output ports, Fallback Task, Logger, IndexedDbVectorStorage, misc fixes
- Updated dependencies
  - @workglow/ai@0.0.103
  - @workglow/ai-provider@0.0.103
  - @workglow/dataset@0.0.103
  - @workglow/debug@0.0.103
  - @workglow/job-queue@0.0.103
  - @workglow/sqlite@0.0.103
  - @workglow/storage@0.0.103
  - @workglow/task-graph@0.0.103
  - @workglow/tasks@0.0.103
  - @workglow/util@0.0.103

## 0.0.102

### Patch Changes

- Update types
- Updated dependencies
  - @workglow/ai@0.0.102
  - @workglow/ai-provider@0.0.102
  - @workglow/dataset@0.0.102
  - @workglow/debug@0.0.102
  - @workglow/job-queue@0.0.102
  - @workglow/sqlite@0.0.102
  - @workglow/storage@0.0.102
  - @workglow/task-graph@0.0.102
  - @workglow/tasks@0.0.102
  - @workglow/util@0.0.102

## 0.0.101

### Patch Changes

- Promote task config to first class schema, remove old name prop in favor of title
- Updated dependencies
  - @workglow/task-graph@0.0.101
  - @workglow/tasks@0.0.101
  - @workglow/ai@0.0.101
  - @workglow/ai-provider@0.0.101
  - @workglow/dataset@0.0.101
  - @workglow/debug@0.0.101
  - @workglow/job-queue@0.0.101
  - @workglow/sqlite@0.0.101
  - @workglow/storage@0.0.101
  - @workglow/util@0.0.101

## 0.0.100

### Patch Changes

- add count token task and fix streaming issues
- Updated dependencies
  - @workglow/ai@0.0.100
  - @workglow/ai-provider@0.0.100
  - @workglow/dataset@0.0.100
  - @workglow/debug@0.0.100
  - @workglow/job-queue@0.0.100
  - @workglow/sqlite@0.0.100
  - @workglow/storage@0.0.100
  - @workglow/task-graph@0.0.100
  - @workglow/tasks@0.0.100
  - @workglow/util@0.0.100

## 0.0.99

### Patch Changes

- Update deps like hf inference
- Updated dependencies
  - @workglow/ai@0.0.99
  - @workglow/ai-provider@0.0.99
  - @workglow/dataset@0.0.99
  - @workglow/debug@0.0.99
  - @workglow/job-queue@0.0.99
  - @workglow/sqlite@0.0.99
  - @workglow/storage@0.0.99
  - @workglow/task-graph@0.0.99
  - @workglow/tasks@0.0.99
  - @workglow/util@0.0.99

## 0.0.98

### Patch Changes

- Update storage for bulk paged reading, add hf dataset storage, add hf inference
- Updated dependencies
  - @workglow/ai@0.0.98
  - @workglow/ai-provider@0.0.98
  - @workglow/dataset@0.0.98
  - @workglow/debug@0.0.98
  - @workglow/job-queue@0.0.98
  - @workglow/sqlite@0.0.98
  - @workglow/storage@0.0.98
  - @workglow/task-graph@0.0.98
  - @workglow/tasks@0.0.98
  - @workglow/util@0.0.98

## 0.0.97

### Patch Changes

- client mcp support via tasks
- Updated dependencies
  - @workglow/ai@0.0.97
  - @workglow/ai-provider@0.0.97
  - @workglow/dataset@0.0.97
  - @workglow/debug@0.0.97
  - @workglow/job-queue@0.0.97
  - @workglow/sqlite@0.0.97
  - @workglow/storage@0.0.97
  - @workglow/task-graph@0.0.97
  - @workglow/tasks@0.0.97
  - @workglow/util@0.0.97

## 0.0.96

### Patch Changes

- fix missing include dep
- Updated dependencies
  - @workglow/ai@0.0.96
  - @workglow/ai-provider@0.0.96
  - @workglow/dataset@0.0.96
  - @workglow/debug@0.0.96
  - @workglow/job-queue@0.0.96
  - @workglow/sqlite@0.0.96
  - @workglow/storage@0.0.96
  - @workglow/task-graph@0.0.96
  - @workglow/tasks@0.0.96
  - @workglow/util@0.0.96

## 0.0.95

### Patch Changes

- fix max tokens and update cli
- Updated dependencies
  - @workglow/ai@0.0.95
  - @workglow/ai-provider@0.0.95
  - @workglow/dataset@0.0.95
  - @workglow/debug@0.0.95
  - @workglow/job-queue@0.0.95
  - @workglow/sqlite@0.0.95
  - @workglow/storage@0.0.95
  - @workglow/task-graph@0.0.95
  - @workglow/tasks@0.0.95
  - @workglow/util@0.0.95

## 0.0.94

### Patch Changes

- update to streaming port across grouped type tasks
- Updated dependencies
  - @workglow/ai-provider@0.0.94
  - @workglow/task-graph@0.0.94
  - @workglow/job-queue@0.0.94
  - @workglow/dataset@0.0.94
  - @workglow/storage@0.0.94
  - @workglow/sqlite@0.0.94
  - @workglow/debug@0.0.94
  - @workglow/tasks@0.0.94
  - @workglow/util@0.0.94
  - @workglow/ai@0.0.94

## 0.0.93

### Patch Changes

- fix export and test
- Updated dependencies
  - @workglow/ai-provider@0.0.93
  - @workglow/task-graph@0.0.93
  - @workglow/job-queue@0.0.93
  - @workglow/dataset@0.0.93
  - @workglow/storage@0.0.93
  - @workglow/sqlite@0.0.93
  - @workglow/debug@0.0.93
  - @workglow/tasks@0.0.93
  - @workglow/util@0.0.93
  - @workglow/ai@0.0.93

## 0.0.92

### Patch Changes

- Fix exports
- Updated dependencies
  - @workglow/ai-provider@0.0.92
  - @workglow/task-graph@0.0.92
  - @workglow/job-queue@0.0.92
  - @workglow/dataset@0.0.92
  - @workglow/storage@0.0.92
  - @workglow/sqlite@0.0.92
  - @workglow/debug@0.0.92
  - @workglow/tasks@0.0.92
  - @workglow/util@0.0.92
  - @workglow/ai@0.0.92

## 0.0.91

### Patch Changes

- Add ai providers like openai; add streaming
- Updated dependencies
  - @workglow/ai-provider@0.0.91
  - @workglow/task-graph@0.0.91
  - @workglow/util@0.0.91
  - @workglow/ai@0.0.91
  - @workglow/dataset@0.0.91
  - @workglow/debug@0.0.91
  - @workglow/job-queue@0.0.91
  - @workglow/sqlite@0.0.91
  - @workglow/storage@0.0.91
  - @workglow/tasks@0.0.91
