# Changelog

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

- `@aws-sdk/client-sqs`: catalog:
- `aws-sdk-client-mock`: catalog:

## 0.3.38

## 0.3.37

## 0.3.36

## 0.3.35

## 0.3.34

## 0.3.33

### Chores

- update deps

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1101.0

## 0.3.32

## 0.3.31

### Chores

- update deps

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1100.0

## 0.3.30

## 0.3.29

### Chores

- update deps

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1098.0

## 0.3.28

## 0.3.27

### Chores

- update package.json scripts to include use-source and use-dist commands

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1092.0

## 0.3.26

### Chores

- update deps

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1088.0

## 0.3.25

## 0.3.24

### Features

- add updateWhere method for atomic conditional updates across all storage backends (#616)

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1084.0

## 0.3.23

### Chores

- update deps

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1084.0

## 0.3.22

### Chores

- update deps

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1079.0

## 0.3.21

## 0.3.20

### Chores

- update deps

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1075.0

## 0.3.19

### Chores

- update deps

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1074.0

## 0.3.18

## 0.3.17

## 0.3.16

### Chores

- update deps

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1073.0

## 0.3.15

### Build

- make timings easier to spot trouble

### Chores

- add homepage

## 0.3.14

### Features

- add bugs URL to package.json files across all packages and providers

### Chores

- update deps

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1068.0

## 0.3.13

## 0.3.12

### Chores

- update deps
- comment review pass across packages and providers
- update dependencies to latest versions

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1063.0

## 0.3.11

## 0.3.10

### Chores

- update deps

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1060.0

## 0.3.9

### Chores

- update deps

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1055.0

## 0.3.8

## 0.3.7

## 0.3.6

### Chores

- update deps, turn off preview libs for now

### Updated Dependencies

- `@aws-sdk/client-sqs`: ^3.1053.0

## 0.3.5

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
