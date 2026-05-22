# Changelog

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
