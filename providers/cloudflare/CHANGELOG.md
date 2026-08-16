# Changelog

## 0.3.45

## 0.3.44

## 0.3.43

## 0.3.42

## 0.3.41

## 0.3.40

## 0.3.39

### Bug Fixes

#### test

- close the gaps the Turbo/projects wiring opened

### Refactors

#### job-queue

- collapse per-backend queue adapters onto wrapQueueStorage (#684)

### Chores

- upgrade to catalog for many deps and update the deps themselves
- update deps

### Updated Dependencies

- `@cloudflare/workers-types`: catalog:

## 0.3.38

## 0.3.37

## 0.3.36

## 0.3.35

## 0.3.34

## 0.3.33

### Updated Dependencies

- `@cloudflare/workers-types`: ^5.20260801.1

## 0.3.32

## 0.3.31

### Chores

- update deps

### Updated Dependencies

- `@cloudflare/workers-types`: ^5.20260731.1

## 0.3.30

## 0.3.29

### Chores

- update deps

### Updated Dependencies

- `@cloudflare/workers-types`: ^5.20260730.1

## 0.3.28

## 0.3.27

### Chores

- update package.json scripts to include use-source and use-dist commands

### Updated Dependencies

- `@cloudflare/workers-types`: ^5.20260721.1

## 0.3.26

### Chores

#### deps

- update @cloudflare/workers-types to 5.x and tslog to 5.x

### Updated Dependencies

- `@cloudflare/workers-types`: ^5.20260715.1

## 0.3.25

## 0.3.24

### Features

- add updateWhere method for atomic conditional updates across all storage backends (#616)

## 0.3.23

## 0.3.22

### Chores

- update deps

### Updated Dependencies

- `@cloudflare/workers-types`: ^4.20260702.1

## 0.3.21

## 0.3.20

### Chores

- update deps

### Updated Dependencies

- `@cloudflare/workers-types`: ^4.20260624.1

## 0.3.19

## 0.3.18

## 0.3.17

### Updated Dependencies

- `@cloudflare/workers-types`: ^4.20260621.1

## 0.3.16

### Chores

- update deps

### Updated Dependencies

- `@cloudflare/workers-types`: ^4.20260619.1

## 0.3.15

### Chores

- add homepage

## 0.3.14

### Features

- add bugs URL to package.json files across all packages and providers

### Chores

- update deps

### Updated Dependencies

- `@cloudflare/workers-types`: ^4.20260612.1

## 0.3.13

## 0.3.12

### Chores

- update deps
- comment review pass across packages and providers
- update dependencies to latest versions

### Updated Dependencies

- `@cloudflare/workers-types`: ^4.20260605.1

## 0.3.11

## 0.3.10

### Chores

- update deps

### Updated Dependencies

- `@cloudflare/workers-types`: ^4.20260603.1

## 0.3.9

### Chores

- update deps

### Updated Dependencies

- `@cloudflare/workers-types`: ^4.20260528.1

## 0.3.8

## 0.3.7

## 0.3.6

### Chores

- update deps, turn off preview libs for now

### Updated Dependencies

- `@cloudflare/workers-types`: ^4.20260523.1

## 0.3.5

### Chores

- update @cloudflare/workers-types dependency to version 4.20260522.1 across multiple package.json files

### Updated Dependencies

- `@cloudflare/workers-types`: ^4.20260522.1

## 0.3.4

## 0.3.3

## 0.3.2

### Bug Fixes

#### aws,cloudflare

- fall back when IJobStore omits markEnqueueDeferredMany
- retry JobStore writes in Claim.ack/fail to avoid stuck PROCESSING rows

#### cloudflare,aws

- validate delaySeconds in sendBatch before creating job rows
- clamp deferred re-delivery to original delaySeconds to avoid pulling delayed messages forward

#### job-queue,aws,cloudflare

- batch markEnqueueDeferred to avoid serial DB hits on batch failure

### Refactors

- remove pre-v1 backward-compat code paths (#523)

### Chores

- update deps

### Updated Dependencies

- `@cloudflare/workers-types`: ^4.20260521.1

## 0.3.1

## 0.3.0

### Features

#### cloudflare

- Cloudflare Queues message-queue adapter (@workglow/cloudflare)
