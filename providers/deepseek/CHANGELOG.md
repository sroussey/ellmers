# Changelog

## 0.3.38

## 0.3.37

## 0.3.36

## 0.3.35

## 0.3.34

### Bug Fixes

#### deepseek

- make tool_choice violations actually retryable

### Refactors

- update maxTokens description and implement reasoning allowances

## 0.3.33

### Features

#### deepseek

- add DeepSeek AI provider

### Bug Fixes

#### deepseek

- enforce a forcing tool_choice client-side
- correct json-mode and tool_choice for the real API

### Documentation

- fix workflow.add( -> workflow.addTask( in provider READMEs

## 0.3.32

### Features

#### deepseek

- Initial DeepSeek provider: text generation, tool calling, structured (JSON)
  generation, rewriting, summarization, token counting, and model search/info
  against the OpenAI-compatible `https://api.deepseek.com` API.
