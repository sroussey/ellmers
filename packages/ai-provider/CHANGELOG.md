# @workglow/ai-provider

## 0.2.31

## 0.2.30

### Refactors

#### ai-provider

- extract cloud provider mixin and OpenAI-shape chat helper (#459)

## 0.2.29

### Refactors

#### ai-provider

- enhance model search functionality

## 0.2.28

### Refactors

#### ai-provider

- final trim of vendor subpaths and SDK peers

#### chrome

- move provider from @workglow/ai-provider to @workglow/chrome

#### tf-mediapipe

- move provider from @workglow/ai-provider to @workglow/tf-mediapipe

#### node-llama-cpp

- move provider from @workglow/ai-provider to @workglow/node-llama-cpp

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

## 0.2.27

## 0.2.26

## 0.2.25

### Tests

- quick fix

## 0.2.24

## 0.2.23

### Features

#### model-search

- add credential_key support for model searches

#### tests

- add model search tests for OpenAI, Anthropic, and Gemini providers

## 0.2.22

## 0.2.21

### Features

#### ai

- image generation pipeline with ImageValue boundary

## 0.2.20

## 0.2.19

## 0.2.18

### Features

#### util/media, tasks/image, ai, task-graph

- GpuImage pipeline (Phases 1-8)

## 0.2.17

### Refactors

#### libs

- rename executeReactive -> executePreview

### Chores

- format changes

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

### Features

#### ai

- AiChatTask, canonical ChatMessage, and worker streaming

## 0.2.8

### Features

#### ai

- session caching for multi-turn AI tasks

#### ai-provider

- interruptable text generation streaming

### Refactors

#### ai-provider

- update tokenizer call in HFT_ToolCalling to return tensors

## 0.2.7

### Features

#### ai

- add model dimensions detail to ModelInfo system

### Refactors

#### ai-provider

- consolidate tool parsers, remove FunctionGemma, and add shared provider utilities

### Chores

- format

## 0.2.6

### Refactors

- reorganize imports and clean up unused code across multiple… (#410)

## 0.2.5

## 0.2.4

## 0.2.3

## 0.2.2

## 0.2.1

## 0.2.0

### Features

- add pkg-pr-new for preview package publishing (#379)
- Task constructor signature, ToolCallingTask and AgentTask (#353)

#### ai

- ToolCallingTask and AgentTask

### Bug Fixes

#### ai-provider

- emit incremental tool call deltas instead of full a… (#392)

### Refactors

#### ai-provider

- improve tool call handling in Anthropic_ToolCalling

### Chores

- release 12 packages
- format changes

## 0.1.3

### Features

- add pkg-pr-new for preview package publishing (#379)
- Task constructor signature, ToolCallingTask and AgentTask (#353)

#### ai

- ToolCallingTask and AgentTask

### Bug Fixes

#### ai-provider

- emit incremental tool call deltas instead of full a… (#392)

### Refactors

#### ai-provider

- improve tool call handling in Anthropic_ToolCalling

### Chores

- format changes

## 0.1.2

## 0.1.1

### Refactors

- improve error handling during model loading in HFT_Pipeline
- update text generation input structure and parameters
- improve backpressure handling in wrapAbortableResponse and update abortableFetch signature

## 0.1.0

### Features

#### ai-provider

- add RNG seed configuration to HfTransformersOnnxModelSchema
- enhance timeout handling and function calling local model support
- add RNG seed configuration for reproducible generation

#### queue-status

- remove JobQueueTask from the task class heirarchy

#### storage

- update McpServerRecordSchema to include auth_type and refactor createMcpStorage function

#### provider

- enhance model caching options with device support

### Bug Fixes

#### ai,ai-provider

- improve security, robustness, and DX across AI packages (#340)

#### provider

- update dtype handling in pipeline configuration

### Refactors

- remove array input support from most AI provider implementations (#333)

#### ai

- remove ToolCallingTask and related utilities
- decouple AI execution from job queue with strategy pattern

### Chores

- remove implementation plan configuration schema and update README with build status badge

## 0.0.126

### Features

- update TypeScript configurations and package exports for improved module resolution

#### ai

- enhance model search functionality with query filtering

## 0.0.125

## 0.0.124

### Features

#### ai-provider

- add displayName property to AiProvider and its implementations

### Bug Fixes

#### ai-provider

- enhance browser environment detection and device handling, failure of which led to device type overwriting and failing models

## 0.0.123

### Features

#### ai-provider

- integrate js-tiktoken for OpenAI token counting in browser

### Refactors

#### imports

- update imports to utilize @workglow/util/schema

## 0.0.122

### Features

#### schema

- introduce @workglow/schema package for schema validation utilities

#### cli

- add model cache directory configuration for HFT worker

### Refactors

- update package exports to use source files instead of dist
- more moving around to make workers smaller (95% smaller now)
- split the sdk off to worker only
- reorg ai-provider a bit more
- export Ollama functions for better tests
- ai provider

#### ai-provider

- introduce queued providers for various AI models

### Chores

- add @typescript/native-preview package and make updates for tsgo

## 0.0.121

## 0.0.120

## 0.0.119

### Features

- add chrome web browser provider (#303)
- enhance token counting for array input in Anthropic and Gemini providers
- add Structured Generation support to HFT and LlamaCpp providers
- enhance AgentTask and content block handling enabling multimedia
- introduce AgentTask for multi-turn agentic loops

### Bug Fixes

- resolve ai-provider test failures from mock leakage and env var … (#299)
- revert streaming accumulation, keep test-only changes
- accumulate text in streaming finish events, add comprehensive provider tests
- resolve batch ToolCalling type errors in HFT provider by collecting typed arrays directly (#297)
- improve type imports and message handling in AgentTask and tests

### Refactors

- unify tool call handling across providers

### Chores

- release 14 packages
- update dependencies in bun.lock and package.json
- update dependencies and account for api changes

## 0.0.118

### Features

- add chrome web browser provider (#303)
- enhance token counting for array input in Anthropic and Gemini providers
- add Structured Generation support to HFT and LlamaCpp providers
- enhance AgentTask and content block handling enabling multimedia
- introduce AgentTask for multi-turn agentic loops

### Bug Fixes

- resolve ai-provider test failures from mock leakage and env var … (#299)
- revert streaming accumulation, keep test-only changes
- accumulate text in streaming finish events, add comprehensive provider tests
- resolve batch ToolCalling type errors in HFT provider by collecting typed arrays directly (#297)
- improve type imports and message handling in AgentTask and tests

### Refactors

- unify tool call handling across providers

### Chores

- update dependencies in bun.lock and package.json
- update dependencies and account for api changes

## 0.0.117

### Features

- add Chrome Built-in AI (web-browser) provider
- enhance token counting for array input in Anthropic and Gemini providers
- add Structured Generation support to HFT and LlamaCpp providers
- enhance AgentTask and content block handling enabling multimedia
- introduce AgentTask for multi-turn agentic loops

### Bug Fixes

- update AIAvailability type and improve availability checks in WebBrowser_JobRunFns
- handle non-monotonic snapshots in snapshotStreamToTextDeltas (#306)
- remove pipeline from WebBrowser model schema (#304)
- remove invalid topK references from TextGeneration run functions
- resolve ai-provider test failures from mock leakage and env var … (#299)
- revert streaming accumulation, keep test-only changes
- accumulate text in streaming finish events, add comprehensive provider tests
- resolve batch ToolCalling type errors in HFT provider by collecting typed arrays directly (#297)
- improve type imports and message handling in AgentTask and tests

### Refactors

- unify tool call handling across providers

### Chores

- add Chrome Built-in AI ambient type declarations
- update dependencies and account for api changes

## 0.0.116

### Bug Fixes

- update ONNX model ID and dtype across multiple files

### Refactors

- clean up code formatting and imports across multiple files
- update type imports and SDK loading in AI provider modules

## 0.0.115

## 0.0.114

## 0.0.113

## 0.0.111

## 0.0.110

### Features

- add build-js and watch-js scripts across packages
- add detail property to ModelInfoTask and enhance HFT_ModelInfo processing

### Bug Fixes

- Use new ModelRegistry from HFT
- ensure type safety for input and output schemas across AI tasks

## 0.0.109

### Features

- introduce ModelInfoTask and enhance AiProvider with local and browser support properties

## 0.0.108

## 0.0.107

### Bug Fixes

- enhance HuggingFace Transformers provider with streaming and reactive tasks support

## 0.0.106

### Features

- add tool-calling command to CLI for sending prompts with tool definitionsl; improved toolcall

## 0.0.105

### Patch Changes

- Storage rename search to query
- Updated dependencies
  - @workglow/ai@0.0.105
  - @workglow/job-queue@0.0.105
  - @workglow/storage@0.0.105
  - @workglow/task-graph@0.0.105
  - @workglow/util@0.0.105

## 0.0.104

### Patch Changes

- Add credential storage and resolution handling
- Updated dependencies
  - @workglow/storage@0.0.104
  - @workglow/ai@0.0.104
  - @workglow/job-queue@0.0.104
  - @workglow/task-graph@0.0.104
  - @workglow/util@0.0.104

## 0.0.103

### Patch Changes

- Structured Outputs, Task timeouts, Error output ports, Fallback Task, Logger, IndexedDbVectorStorage, misc fixes
- Updated dependencies
  - @workglow/ai@0.0.103
  - @workglow/job-queue@0.0.103
  - @workglow/storage@0.0.103
  - @workglow/task-graph@0.0.103
  - @workglow/util@0.0.103

## 0.0.102

### Patch Changes

- Update types
- Updated dependencies
  - @workglow/ai@0.0.102
  - @workglow/job-queue@0.0.102
  - @workglow/storage@0.0.102
  - @workglow/task-graph@0.0.102
  - @workglow/util@0.0.102

## 0.0.101

### Patch Changes

- Promote task config to first class schema, remove old name prop in favor of title
- Updated dependencies
  - @workglow/task-graph@0.0.101
  - @workglow/ai@0.0.101
  - @workglow/job-queue@0.0.101
  - @workglow/storage@0.0.101
  - @workglow/util@0.0.101

## 0.0.100

### Patch Changes

- add count token task and fix streaming issues
- Updated dependencies
  - @workglow/ai@0.0.100
  - @workglow/job-queue@0.0.100
  - @workglow/storage@0.0.100
  - @workglow/task-graph@0.0.100
  - @workglow/util@0.0.100

## 0.0.99

### Patch Changes

- Update deps like hf inference
- Updated dependencies
  - @workglow/ai@0.0.99
  - @workglow/job-queue@0.0.99
  - @workglow/storage@0.0.99
  - @workglow/task-graph@0.0.99
  - @workglow/util@0.0.99

## 0.0.98

### Patch Changes

- Update storage for bulk paged reading, add hf dataset storage, add hf inference
- Updated dependencies
  - @workglow/ai@0.0.98
  - @workglow/job-queue@0.0.98
  - @workglow/storage@0.0.98
  - @workglow/task-graph@0.0.98
  - @workglow/util@0.0.98

## 0.0.97

### Patch Changes

- client mcp support via tasks
- Updated dependencies
  - @workglow/ai@0.0.97
  - @workglow/job-queue@0.0.97
  - @workglow/storage@0.0.97
  - @workglow/task-graph@0.0.97
  - @workglow/util@0.0.97

## 0.0.96

### Patch Changes

- fix missing include dep
- Updated dependencies
  - @workglow/ai@0.0.96
  - @workglow/job-queue@0.0.96
  - @workglow/storage@0.0.96
  - @workglow/task-graph@0.0.96
  - @workglow/util@0.0.96

## 0.0.95

### Patch Changes

- fix max tokens and update cli
- Updated dependencies
  - @workglow/ai@0.0.95
  - @workglow/job-queue@0.0.95
  - @workglow/storage@0.0.95
  - @workglow/task-graph@0.0.95
  - @workglow/util@0.0.95

## 0.0.94

### Patch Changes

- update to streaming port across grouped type tasks
- Updated dependencies
  - @workglow/task-graph@0.0.94
  - @workglow/job-queue@0.0.94
  - @workglow/storage@0.0.94
  - @workglow/util@0.0.94
  - @workglow/ai@0.0.94

## 0.0.93

### Patch Changes

- fix export and test
- Updated dependencies
  - @workglow/task-graph@0.0.93
  - @workglow/job-queue@0.0.93
  - @workglow/storage@0.0.93
  - @workglow/util@0.0.93
  - @workglow/ai@0.0.93

## 0.0.92

### Patch Changes

- Fix exports
- Updated dependencies
  - @workglow/task-graph@0.0.92
  - @workglow/job-queue@0.0.92
  - @workglow/storage@0.0.92
  - @workglow/util@0.0.92
  - @workglow/ai@0.0.92

## 0.0.91

### Patch Changes

- Add ai providers like openai; add streaming
- Updated dependencies
  - @workglow/task-graph@0.0.91
  - @workglow/util@0.0.91
  - @workglow/ai@0.0.91
  - @workglow/job-queue@0.0.91
  - @workglow/storage@0.0.91

## 0.0.90

### Patch Changes

- Introduce Loop tasks: Map, Reduce, and While
- Updated dependencies
  - @workglow/task-graph@0.0.90
  - @workglow/util@0.0.90
  - @workglow/ai@0.0.90
  - @workglow/job-queue@0.0.90
  - @workglow/storage@0.0.90

## 0.0.89

### Patch Changes

- Fix subgraph reactive
- Updated dependencies
  - @workglow/ai@0.0.89
  - @workglow/job-queue@0.0.89
  - @workglow/storage@0.0.89
  - @workglow/task-graph@0.0.89
  - @workglow/util@0.0.89

## 0.0.88

### Patch Changes

- Revert adding loop tasks, push other fixes
- Updated dependencies
  - @workglow/task-graph@0.0.88
  - @workglow/job-queue@0.0.88
  - @workglow/storage@0.0.88
  - @workglow/util@0.0.88
  - @workglow/ai@0.0.88

## 0.0.87

### Patch Changes

- bad version with loop not ready for prime time
- Updated dependencies
  - @workglow/ai@0.0.87
  - @workglow/job-queue@0.0.87
  - @workglow/storage@0.0.87
  - @workglow/task-graph@0.0.87
  - @workglow/util@0.0.87

## 0.0.86

### Patch Changes

- Add concept of Datasets, rename all storage class in storage to end in storage, added some RAG tasks
- Updated dependencies
  - @workglow/ai@0.0.86
  - @workglow/job-queue@0.0.86
  - @workglow/storage@0.0.86
  - @workglow/task-graph@0.0.86
  - @workglow/util@0.0.86

## 0.0.85

### Patch Changes

- Add FileLoaderTask and Ai tasks can use model config directly
- Updated dependencies
  - @workglow/ai@0.0.85
  - @workglow/job-queue@0.0.85
  - @workglow/storage@0.0.85
  - @workglow/task-graph@0.0.85
  - @workglow/util@0.0.85

## 0.0.84

### Patch Changes

- Fix model lookup for named entity rec
- Updated dependencies
  - @workglow/ai@0.0.84
  - @workglow/job-queue@0.0.84
  - @workglow/storage@0.0.84
  - @workglow/task-graph@0.0.84
  - @workglow/util@0.0.84

## 0.0.83

### Patch Changes

- Update definitions for secondary key array as const
- Updated dependencies
  - @workglow/ai@0.0.83
  - @workglow/job-queue@0.0.83
  - @workglow/storage@0.0.83
  - @workglow/task-graph@0.0.83
  - @workglow/util@0.0.83

## 0.0.82

### Patch Changes

- Small updates for model definitions and repo
- Updated dependencies
  - @workglow/task-graph@0.0.82
  - @workglow/job-queue@0.0.82
  - @workglow/storage@0.0.82
  - @workglow/util@0.0.82
  - @workglow/ai@0.0.82

## 0.0.81

### Patch Changes

- Fix mediapipe download for vision models
- Updated dependencies
  - @workglow/task-graph@0.0.81
  - @workglow/job-queue@0.0.81
  - @workglow/storage@0.0.81
  - @workglow/util@0.0.81
  - @workglow/ai@0.0.81

## 0.0.80

### Patch Changes

- Renamed FetchTask to FetchUrlTask, and camelCased the workflow methods, all breaking changes
- Updated dependencies
  - @workglow/ai@0.0.80
  - @workglow/job-queue@0.0.80
  - @workglow/storage@0.0.80
  - @workglow/task-graph@0.0.80
  - @workglow/util@0.0.80

## 0.0.79

### Patch Changes

- Merge and Split
- Updated dependencies
  - @workglow/ai@0.0.79
  - @workglow/job-queue@0.0.79
  - @workglow/storage@0.0.79
  - @workglow/task-graph@0.0.79
  - @workglow/util@0.0.79

## 0.0.78

### Patch Changes

- Added Input and Output tasks and rewrote deleteSearch to not be lame
- Updated dependencies
  - @workglow/ai@0.0.78
  - @workglow/job-queue@0.0.78
  - @workglow/storage@0.0.78
  - @workglow/task-graph@0.0.78
  - @workglow/util@0.0.78

## 0.0.77

### Patch Changes

- semantic compat via format should allow dashes
- Updated dependencies
  - @workglow/task-graph@0.0.77
  - @workglow/job-queue@0.0.77
  - @workglow/storage@0.0.77
  - @workglow/util@0.0.77
  - @workglow/ai@0.0.77

## 0.0.76

### Patch Changes

- fix array task reactive
- Updated dependencies
  - @workglow/task-graph@0.0.76
  - @workglow/ai@0.0.76
  - @workglow/job-queue@0.0.76
  - @workglow/storage@0.0.76
  - @workglow/util@0.0.76

## 0.0.75

### Patch Changes

- Change priority order for image transfer across workers
- Updated dependencies
  - @workglow/task-graph@0.0.75
  - @workglow/job-queue@0.0.75
  - @workglow/storage@0.0.75
  - @workglow/util@0.0.75
  - @workglow/ai@0.0.75

## 0.0.74

### Patch Changes

- Another attempt at transferables
- Updated dependencies
  - @workglow/task-graph@0.0.74
  - @workglow/job-queue@0.0.74
  - @workglow/storage@0.0.74
  - @workglow/util@0.0.74
  - @workglow/ai@0.0.74

## 0.0.73

### Patch Changes

- Fix serious bug that made ai tasks fail
- Updated dependencies
  - @workglow/ai@0.0.73
  - @workglow/job-queue@0.0.73
  - @workglow/storage@0.0.73
  - @workglow/task-graph@0.0.73
  - @workglow/util@0.0.73

## 0.0.72

### Patch Changes

- Add Vision/Image tasks
- Updated dependencies
  - @workglow/task-graph@0.0.72
  - @workglow/job-queue@0.0.72
  - @workglow/storage@0.0.72
  - @workglow/util@0.0.72
  - @workglow/ai@0.0.72

## 0.0.71

### Patch Changes

- Add TextFillMaskTask and TextNamedEntityRecognitionTask
- Updated dependencies
  - @workglow/ai@0.0.71
  - @workglow/job-queue@0.0.71
  - @workglow/storage@0.0.71
  - @workglow/task-graph@0.0.71
  - @workglow/util@0.0.71

## 0.0.70

### Patch Changes

- Updates to download progress, etc
- Updated dependencies
  - @workglow/ai@0.0.70
  - @workglow/job-queue@0.0.70
  - @workglow/storage@0.0.70
  - @workglow/task-graph@0.0.70
  - @workglow/util@0.0.70

## 0.0.69

### Patch Changes

- Fix build
- Updated dependencies
  - @workglow/ai@0.0.69
  - @workglow/job-queue@0.0.69
  - @workglow/storage@0.0.69
  - @workglow/task-graph@0.0.69
  - @workglow/util@0.0.69

## 0.0.68

### Patch Changes

- Fix missing unload model task in worker version
- Updated dependencies
  - @workglow/ai@0.0.68
  - @workglow/job-queue@0.0.68
  - @workglow/storage@0.0.68
  - @workglow/task-graph@0.0.68
  - @workglow/util@0.0.68

## 0.0.67

### Patch Changes

- Add new tasks: UnloadModelTask, TextClassifierTask, TextLanguageDetectionTask
- Updated dependencies
  - @workglow/ai@0.0.67
  - @workglow/job-queue@0.0.67
  - @workglow/storage@0.0.67
  - @workglow/task-graph@0.0.67
  - @workglow/util@0.0.67

## 0.0.66

### Patch Changes

- Subscriptions for all tabular repositories
- Updated dependencies
  - @workglow/ai@0.0.66
  - @workglow/job-queue@0.0.66
  - @workglow/storage@0.0.66
  - @workglow/task-graph@0.0.66
  - @workglow/util@0.0.66

## 0.0.65

### Patch Changes

- Add a subscription to task graph for child progress events
- Updated dependencies
  - @workglow/ai@0.0.65
  - @workglow/job-queue@0.0.65
  - @workglow/storage@0.0.65
  - @workglow/task-graph@0.0.65
  - @workglow/util@0.0.65

## 0.0.64

### Patch Changes

- Fix indexeddb queue to not mark completed on every progress message which made it look like it was retrying
- Updated dependencies
  - @workglow/ai@0.0.64
  - @workglow/job-queue@0.0.64
  - @workglow/storage@0.0.64
  - @workglow/task-graph@0.0.64
  - @workglow/util@0.0.64

## 0.0.63

### Patch Changes

- Fix more max try issues
- Updated dependencies
  - @workglow/ai@0.0.63
  - @workglow/job-queue@0.0.63
  - @workglow/storage@0.0.63
  - @workglow/task-graph@0.0.63
  - @workglow/util@0.0.63

## 0.0.62

### Patch Changes

- Update the queue system with fixes around max retries
- Updated dependencies
  - @workglow/ai@0.0.62
  - @workglow/job-queue@0.0.62
  - @workglow/storage@0.0.62
  - @workglow/task-graph@0.0.62
  - @workglow/util@0.0.62

## 0.0.61

### Patch Changes

- Update model config bugs with narrowing
- Updated dependencies
  - @workglow/ai@0.0.61
  - @workglow/job-queue@0.0.61
  - @workglow/storage@0.0.61
  - @workglow/task-graph@0.0.61
  - @workglow/util@0.0.61

## 0.0.60

### Patch Changes

- Rework and simplify the model repo
- Updated dependencies
  - @workglow/task-graph@0.0.60
  - @workglow/job-queue@0.0.60
  - @workglow/storage@0.0.60
  - @workglow/util@0.0.60
  - @workglow/ai@0.0.60

## 0.0.59

### Patch Changes

- Rework model config
- Updated dependencies
  - @workglow/storage@0.0.59
  - @workglow/util@0.0.59
  - @workglow/ai@0.0.59
  - @workglow/job-queue@0.0.59
  - @workglow/task-graph@0.0.59

## 0.0.58

### Patch Changes

- Refactored the lame job queue into a less lame job queue
- Updated dependencies
  - @workglow/task-graph@0.0.58
  - @workglow/job-queue@0.0.58
  - @workglow/storage@0.0.58
  - @workglow/ai@0.0.58
  - @workglow/util@0.0.58

## 0.0.57

### Patch Changes

- Change JSON formats to use property name defaults instead of input
- Updated dependencies
  - @workglow/ai@0.0.57
  - @workglow/job-queue@0.0.57
  - @workglow/storage@0.0.57
  - @workglow/task-graph@0.0.57
  - @workglow/util@0.0.57

## 0.0.56

### Patch Changes

- Update TaskGraph to add subscriptions for status changes for tasks and dataflows
- Updated dependencies
  - @workglow/task-graph@0.0.56
  - @workglow/util@0.0.56
  - @workglow/ai@0.0.56
  - @workglow/job-queue@0.0.56
  - @workglow/storage@0.0.56

## 0.0.55

### Patch Changes

- Update deps
- Updated dependencies
  - @workglow/ai@0.0.55
  - @workglow/job-queue@0.0.55
  - @workglow/storage@0.0.55
  - @workglow/task-graph@0.0.55
  - @workglow/util@0.0.55

## 0.0.54

### Patch Changes

- Update output shcema on input changes for FetchTask
- Updated dependencies
  - @workglow/task-graph@0.0.54
  - @workglow/job-queue@0.0.54
  - @workglow/storage@0.0.54
  - @workglow/util@0.0.54
  - @workglow/ai@0.0.54

## 0.0.53

### Patch Changes

- Update FetchTask to use dynamic output schema
- Updated dependencies
  - @workglow/ai@0.0.53
  - @workglow/job-queue@0.0.53
  - @workglow/storage@0.0.53
  - @workglow/task-graph@0.0.53
  - @workglow/util@0.0.53

## 0.0.52

### Patch Changes

- First release under "workglow" naming
- Updated dependencies
  - @workglow/task-graph@0.0.52
  - @workglow/job-queue@0.0.52
  - @workglow/storage@0.0.52
  - @workglow/util@0.0.52
  - @workglow/ai@0.0.52
