# Changelog

## 0.3.4

## 0.3.3

## 0.3.2

### Bug Fixes

#### aws,cloudflare

- fall back when IJobStore omits markEnqueueDeferredMany
- retry JobStore writes in Claim.ack/fail to avoid stuck PROCESSING rows

#### cloudflare,aws

- clamp deferred re-delivery to original delaySeconds to avoid pulling delayed messages forward

#### job-queue,aws,cloudflare

- batch markEnqueueDeferred to avoid serial DB hits on batch failure

### Refactors

- remove pre-v1 backward-compat code paths (#523)

### Chores

- update deps

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1052.0

## 0.3.1

## 0.3.0

### Features

#### aws

- SQS message-queue adapter (@workglow/aws)
