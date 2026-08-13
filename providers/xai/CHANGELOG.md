# Changelog

## 0.3.39

### Features

- enhance model existence verification in AI provider streams
- enhance provisional usage reporting in AI provider streams

#### models

- update pricing and add new model for DeepSeek

### Bug Fixes

#### ai

- require explicit ModelPricing rates and make the type assertion enforceable

#### util

- last complete object wins when skipping JSON preamble (#718)

### Performance

#### util

- add an incremental partial-JSON stream parser (#681)

### Chores

#### eslint

- enforce consistent-type-imports and apply the repo-wide autofix (#683)

## 0.3.38

## 0.3.37

## 0.3.36

## 0.3.35

## 0.3.34

## 0.3.33

### Documentation

- fix workflow.add( -> workflow.addTask( in provider READMEs

## 0.3.32

## 0.3.31

## 0.3.30

## 0.3.29

## 0.3.28

## 0.3.27

## 0.3.26

### Bug Fixes

#### xai,openrouter

- guard chunk.choices access and downshift strict schema

## 0.3.25

### Features

#### providers

- add xAI (Grok) AI provider(#622)

## 0.3.24

### Features

- initial release: xAI (Grok) provider for `@workglow/ai`
